/**
 * SmartExam WebRTC & Web Audio API Engine (HD & Mobile Optimized)
 * Multi-participant WebRTC media transmission (Audio/Video/Screen),
 * HD 720p/1080p constraints, Echo Cancellation, Noise Suppression,
 * Device Selection, Voice Activity Detection, ICE auto-reconnect.
 */

class WebRTCManager {
    constructor() {
        this.peers = {}; // targetUserId -> { pc, remoteStream, streamType }
        this.localStream = null;
        this.localScreenStream = null;
        this.audioContext = null;
        this.analyser = null;
        this.speakingInterval = null;
        this.currentVideoDeviceId = null;
        this.currentAudioDeviceId = null;
        
        // Diagnostics State
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
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };
    }

    /**
     * Get available Audio & Video Input Devices
     */
    async getDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            const videoInputs = devices.filter(d => d.kind === 'videoinput');
            return { audioInputs, videoInputs };
        } catch (e) {
            console.warn('[WebRTC] Could not enumerate devices:', e);
            return { audioInputs: [], videoInputs: [] };
        }
    }

    /**
     * Initialize Local Media (Camera + Microphone) with HD constraints & Noise Suppression
     */
    async initLocalMedia(videoElemId, speakingCallback = null, audioDeviceId = null, videoDeviceId = null) {
        try {
            console.log('[WebRTC] Requesting HD local media (Camera + Microphone)...');
            
            const constraints = {
                video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    frameRate: { ideal: 30, max: 60 },
                    facingMode: 'user'
                },
                audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            };

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

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
                localVideo.setAttribute('webkit-playsinline', '');
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

            // Fallback to basic constraints if HD fail on low-end mobile
            if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
                console.warn('[WebRTC] HD constraints failed. Retrying with basic mobile constraints...');
                try {
                    this.localStream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'user' },
                        audio: { echoCancellation: true, noiseSuppression: true }
                    });
                    const localVideo = document.getElementById(videoElemId);
                    if (localVideo) {
                        localVideo.srcObject = this.localStream;
                        localVideo.muted = true;
                        localVideo.setAttribute('autoplay', '');
                        localVideo.setAttribute('playsinline', '');
                        try { await localVideo.play(); } catch (e) {}
                    }
                    return this.localStream;
                } catch (e2) {
                    console.error('[WebRTC] Fallback failed:', e2);
                }
            }

            if (err.name === 'NotAllowedError') {
                alert('Camera / Microphone permission denied. Please allow permissions in browser settings.');
            }
            return null;
        }
    }

    /**
     * Microphones & Camera Toggles
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
     * Web Audio API Voice Activity / Active Speaker Detection
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
                const speakingNow = rms > 12;

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
     * Connect to Peer with ICE Restart and Auto-Reconnection
     */
    async connectToPeer(targetUserId, classId, remoteVideoElemId = null, isInitiator = false) {
        if (this.peers[targetUserId]) {
            return this.peers[targetUserId];
        }

        console.log(`[WebRTC] Creating RTCPeerConnection for User ${targetUserId} (Initiator: ${isInitiator})...`);
        const pc = new RTCPeerConnection(this.iceServers);

        const peerObj = {
            pc: pc,
            targetUserId: targetUserId,
            remoteStream: new MediaStream()
        };
        this.peers[targetUserId] = peerObj;

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] Peer ${targetUserId} Connection State: ${pc.connectionState}`);
            this.debugState.peerState = pc.connectionState.toUpperCase();
            this.updateDebugPanel();

            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                console.warn(`[WebRTC] Connection lost with User ${targetUserId}. Reconnecting...`);
                setTimeout(() => {
                    if (pc.restartIce) pc.restartIce();
                }, 2000);
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`[WebRTC] Peer ${targetUserId} ICE State: ${pc.iceConnectionState}`);
            this.debugState.iceState = pc.iceConnectionState.toUpperCase();
            this.updateDebugPanel();
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignaling(classId, targetUserId, 'candidate', event.candidate);
            }
        };

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
                remoteVideo.muted = false;
                remoteVideo.setAttribute('autoplay', '');
                remoteVideo.setAttribute('playsinline', '');
                remoteVideo.setAttribute('webkit-playsinline', '');
                remoteVideo.style.display = 'block';
                if (remoteAvatar) remoteAvatar.style.display = 'none';

                try {
                    remoteVideo.play().catch(e => console.warn('[WebRTC] Autoplay remote video warning:', e));
                } catch (e) {}
            }
        };

        if (isInitiator) {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.sendSignaling(classId, targetUserId, 'offer', offer);
            } catch (e) {
                console.error('[WebRTC] Offer creation error:', e);
            }
        }

        return peerObj;
    }

    /**
     * Receive Signaling (Offer / Answer / Candidate)
     */
    async handleSignaling(classId, senderUserId, type, data, remoteVideoElemId = null) {
        let peerObj = this.peers[senderUserId];
        if (!peerObj) {
            peerObj = await this.connectToPeer(senderUserId, classId, remoteVideoElemId, false);
        }

        const pc = peerObj.pc;

        try {
            if (type === 'offer') {
                console.log(`[WebRTC] Received SDP Offer from User ${senderUserId}`);
                await pc.setRemoteDescription(new RTCSessionDescription(data));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.sendSignaling(classId, senderUserId, 'answer', answer);
            } else if (type === 'answer') {
                console.log(`[WebRTC] Received SDP Answer from User ${senderUserId}`);
                await pc.setRemoteDescription(new RTCSessionDescription(data));
            } else if (type === 'candidate') {
                console.log(`[WebRTC] Received ICE Candidate from User ${senderUserId}`);
                await pc.addIceCandidate(new RTCIceCandidate(data));
            }
        } catch (e) {
            console.error(`[WebRTC] Signaling handling error (${type}):`, e);
        }
    }

    /**
     * Send Signaling to Server
     */
    async sendSignaling(classId, targetUserId, signalType, payload) {
        try {
            await fetch('/api/webrtc/signal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    class_id: classId,
                    target_user_id: targetUserId,
                    signal_type: signalType,
                    payload: payload
                })
            });
        } catch (e) {
            console.error('[WebRTC] Signaling send error:', e);
        }
    }

    /**
     * Screen Sharing Transmission
     */
    async startScreenShare(classId, targetVideoId) {
        try {
            console.log('[WebRTC] Starting Screen Share...');
            this.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio: false
            });

            const screenVideoTrack = this.localScreenStream.getVideoTracks()[0];

            Object.values(this.peers).forEach(peerObj => {
                const sender = peerObj.pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenVideoTrack);
                }
            });

            const localVideo = document.getElementById(targetVideoId);
            if (localVideo) {
                localVideo.srcObject = this.localScreenStream;
            }

            screenVideoTrack.onended = () => {
                this.stopScreenShare(targetVideoId);
            };

            return this.localScreenStream;
        } catch (err) {
            console.error('[WebRTC] Screen sharing error:', err);
            return null;
        }
    }

    stopScreenShare(targetVideoId) {
        if (!this.localScreenStream) return;
        this.localScreenStream.getTracks().forEach(track => track.stop());

        if (this.localStream) {
            const cameraTrack = this.localStream.getVideoTracks()[0];
            Object.values(this.peers).forEach(peerObj => {
                const sender = peerObj.pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender && cameraTrack) {
                    sender.replaceTrack(cameraTrack);
                }
            });

            const localVideo = document.getElementById(targetVideoId);
            if (localVideo) {
                localVideo.srcObject = this.localStream;
            }
        }
        this.localScreenStream = null;
    }

    /**
     * UI Diagnostics Update
     */
    updateDebugPanel() {
        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.innerText = val;
        };

        setTxt('dbg_is_https', this.debugState.isHttps);
        setTxt('dbg_is_secure', this.debugState.isSecureContext);
        setTxt('dbg_cam_perm', this.debugState.cameraPermission);
        setTxt('dbg_mic_perm', this.debugState.micPermission);
        setTxt('dbg_loc_vid', this.debugState.localVideoTracks);
        setTxt('dbg_loc_aud', this.debugState.localAudioTracks);
        setTxt('dbg_peer_state', this.debugState.peerState);
        setTxt('dbg_ice_state', this.debugState.iceState);
        setTxt('dbg_rem_vid', this.debugState.remoteVideoTracks);
        setTxt('dbg_rem_aud', this.debugState.remoteAudioTracks);
    }
}

window.WebRTCManager = WebRTCManager;
