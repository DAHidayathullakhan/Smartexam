/**
 * SmartExam WebRTC & Web Audio API Engine
 * Handles real multi-participant WebRTC media transmission (Audio/Video/Screen),
 * SDP Offer/Answer flow, ICE candidate exchange, voice activity detection,
 * and live WebRTC Debug Panel diagnostics.
 */

class WebRTCManager {
    constructor() {
        this.peers = {}; // targetUserId -> { pc, remoteStream, streamType }
        this.localStream = null;
        this.localScreenStream = null;
        this.audioContext = null;
        this.analyser = null;
        this.speakingInterval = null;
        
        // Debug statistics
        this.debugState = {
            isHttps: location.protocol === 'https:' ? 'YES 🟢' : 'NO 🔴',
            isSecureContext: (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'YES 🟢' : 'NO 🔴',
            cameraPermission: 'NOT REQUESTED',
            micPermission: 'NOT REQUESTED',
            localVideoTracks: 0,
            localAudioTracks: 0,
            peerState: 'NEW',
            iceState: 'NEW',
            remoteVideoTracks: 0,
            remoteAudioTracks: 0
        };

        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
    }

    /**
     * 1. Initialize Local Media (Camera + Microphone)
     */
    async initLocalMedia(videoElemId, speakingCallback = null) {
        try {
            console.log('[WebRTC] Requesting local media stream (Camera + Microphone)...');
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 30 } },
                audio: true
            });

            this.debugState.cameraPermission = 'GRANTED 🟢';
            this.debugState.micPermission = 'GRANTED 🟢';
            this.debugState.localVideoTracks = this.localStream.getVideoTracks().length;
            this.debugState.localAudioTracks = this.localStream.getAudioTracks().length;
            this.updateDebugPanel();

            const localVideo = document.getElementById(videoElemId);
            if (localVideo) {
                localVideo.srcObject = this.localStream;
                localVideo.muted = true; // Local echo prevention
                localVideo.setAttribute('autoplay', '');
                localVideo.setAttribute('playsinline', '');
                try { await localVideo.play(); } catch (e) {}
            }

            if (speakingCallback) {
                this.setupAudioAnalyzer(speakingCallback);
            }

            return this.localStream;
        } catch (err) {
            console.error('[WebRTC] Local media access error:', err);
            this.debugState.cameraPermission = err.name === 'NotAllowedError' ? 'DENIED 🔴' : 'ERROR 🔴';
            this.debugState.micPermission = err.name === 'NotAllowedError' ? 'DENIED 🔴' : 'ERROR 🔴';
            this.updateDebugPanel();

            if (err.name === 'NotAllowedError') {
                alert('Camera / Microphone permission denied. Please allow camera access in browser settings.');
            } else if (err.name === 'NotFoundError') {
                alert('No camera or microphone device found.');
            }
            return null;
        }
    }

    /**
     * 2. Microphones & Camera Toggles
     */
    toggleMicrophone(enabled) {
        if (!this.localStream) return;
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = enabled;
        });
        this.debugState.localAudioTracks = enabled ? this.localStream.getAudioTracks().length : 0;
        this.updateDebugPanel();
    }

    toggleCamera(enabled) {
        if (!this.localStream) return;
        this.localStream.getVideoTracks().forEach(track => {
            track.enabled = enabled;
        });
        this.debugState.localVideoTracks = enabled ? this.localStream.getVideoTracks().length : 0;
        this.updateDebugPanel();
    }

    /**
     * 3. Web Audio API Voice Activity / Speaking Detection
     */
    setupAudioAnalyzer(speakingCallback) {
        try {
            if (!this.localStream || this.localStream.getAudioTracks().length === 0) return;

            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 512;
            source.connect(this.analyser);

            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            let isSpeaking = false;

            if (this.speakingInterval) clearInterval(this.speakingInterval);
            this.speakingInterval = setInterval(() => {
                this.analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i];
                }
                const rms = Math.sqrt(sum / bufferLength);
                const speakingNow = rms > 12; // Audio threshold

                if (speakingNow !== isSpeaking) {
                    isSpeaking = speakingNow;
                    speakingCallback(isSpeaking);
                }
            }, 150);
        } catch (e) {
            console.warn('[WebRTC] Audio analyzer setup warning:', e);
        }
    }

    /**
     * 4. Connect to Peer (RTCPeerConnection Setup, Track Binding, Offer/Answer Flow)
     */
    async connectToPeer(targetUserId, classId, remoteVideoElemId = null, isInitiator = false) {
        if (this.peers[targetUserId]) {
            return this.peers[targetUserId];
        }

        console.log(`[WebRTC] Creating RTCPeerConnection for Target User ${targetUserId} (Initiator: ${isInitiator})...`);
        const pc = new RTCPeerConnection(this.iceServers);

        const peerObj = {
            pc: pc,
            targetUserId: targetUserId,
            remoteStream: new MediaStream()
        };
        this.peers[targetUserId] = peerObj;

        // 4a. Add Local Media Tracks to PeerConnection BEFORE Offer Generation
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                console.log(`[WebRTC] Adding local track (${track.kind}) to PeerConnection for User ${targetUserId}`);
                pc.addTrack(track, this.localStream);
            });
        }

        // 4b. Peer Connection & ICE Connection State Tracking
        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] Peer ${targetUserId} Connection State: ${pc.connectionState}`);
            this.debugState.peerState = pc.connectionState.toUpperCase();
            this.updateDebugPanel();
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`[WebRTC] Peer ${targetUserId} ICE State: ${pc.iceConnectionState}`);
            this.debugState.iceState = pc.iceConnectionState.toUpperCase();
            this.updateDebugPanel();
        };

        // 4c. ICE Candidate Handler
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignaling(classId, targetUserId, 'candidate', event.candidate);
            }
        };

        // 4d. Remote Track Event Handler (Actual Audio & Video Media Reception)
        pc.ontrack = (event) => {
            console.log(`[WebRTC] Received Remote Track (${event.track.kind}) from User ${targetUserId}`);
            peerObj.remoteStream.addTrack(event.track);

            this.debugState.remoteVideoTracks = peerObj.remoteStream.getVideoTracks().length;
            this.debugState.remoteAudioTracks = peerObj.remoteStream.getAudioTracks().length;
            this.updateDebugPanel();

            const targetVideoId = remoteVideoElemId || `video_user_${targetUserId}`;
            const targetAvatarId = `avatar_user_${targetUserId}`;
            const remoteVideo = document.getElementById(targetVideoId);
            const remoteAvatar = document.getElementById(targetAvatarId);

            if (remoteVideo) {
                remoteVideo.srcObject = peerObj.remoteStream;
                remoteVideo.muted = false; // TEACHER & OTHERS MUST HEAR REMOTE AUDIO
                remoteVideo.setAttribute('autoplay', '');
                remoteVideo.setAttribute('playsinline', '');
                remoteVideo.style.display = 'block';
                if (remoteAvatar) remoteAvatar.style.display = 'none';

                try {
                    remoteVideo.play().catch(e => console.warn('[WebRTC] Autoplay remote video warning:', e));
                } catch (e) {}
            }
        };

        // 4e. Initiator: Create and Send SDP Offer
        if (isInitiator) {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                await this.sendSignaling(classId, targetUserId, 'offer', offer);
            } catch (err) {
                console.error(`[WebRTC] Error creating SDP offer for User ${targetUserId}:`, err);
            }
        }

        return peerObj;
    }

    /**
     * 5. Process Incoming Signaling Payload (Offer / Answer / ICE Candidate)
     */
    async handleSignalingData(classId, fromUserId, signalType, payload) {
        let peerObj = this.peers[fromUserId];
        if (!peerObj) {
            peerObj = await this.connectToPeer(fromUserId, classId, null, false);
        }
        const pc = peerObj.pc;

        try {
            if (signalType === 'offer') {
                console.log(`[WebRTC] Handling SDP Offer from User ${fromUserId}`);
                await pc.setRemoteDescription(new RTCSessionDescription(payload));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await this.sendSignaling(classId, fromUserId, 'answer', answer);
            } else if (signalType === 'answer') {
                console.log(`[WebRTC] Handling SDP Answer from User ${fromUserId}`);
                await pc.setRemoteDescription(new RTCSessionDescription(payload));
            } else if (signalType === 'candidate') {
                console.log(`[WebRTC] Adding ICE Candidate from User ${fromUserId}`);
                await pc.addIceCandidate(new RTCIceCandidate(payload));
            }
        } catch (err) {
            console.error(`[WebRTC] Error processing signaling signal (${signalType}) from User ${fromUserId}:`, err);
        }
    }

    /**
     * 6. Send Signaling via Backend Endpoint
     */
    async sendSignaling(classId, targetUserId, action, data) {
        try {
            await fetch('/api/webrtc/signaling', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    class_id: classId,
                    target_user_id: targetUserId,
                    action: action,
                    data: data
                })
            });
        } catch (err) {
            console.error('[WebRTC] Signaling POST error:', err);
        }
    }

    /**
     * 7. Update WebRTC Debug Panel UI
     */
    updateDebugPanel() {
        const setTxt = (id, txt) => {
            const el = document.getElementById(id);
            if (el) el.innerText = txt;
        };

        setTxt('dbgHttps', this.debugState.isHttps);
        setTxt('dbgSecureContext', this.debugState.isSecureContext);
        setTxt('dbgCamPerm', this.debugState.cameraPermission);
        setTxt('dbgMicPerm', this.debugState.micPermission);
        setTxt('dbgLocalVideoTracks', this.debugState.localVideoTracks);
        setTxt('dbgLocalAudioTracks', this.debugState.localAudioTracks);
        setTxt('dbgPeerState', this.debugState.peerState);
        setTxt('dbgIceState', this.debugState.iceState);
        setTxt('dbgRemoteVideoTracks', this.debugState.remoteVideoTracks);
        setTxt('dbgRemoteAudioTracks', this.debugState.remoteAudioTracks);
    }

    /**
     * 8. Clean up Peer Connection
     */
    closePeer(targetUserId) {
        if (this.peers[targetUserId]) {
            try {
                this.peers[targetUserId].pc.close();
            } catch (e) {}
            delete this.peers[targetUserId];
        }
    }
}

// Global Singleton Instance
window.WebRTCManager = new WebRTCManager();
