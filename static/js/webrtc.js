/**
 * SmartExam Production WebRTC Engine
 * Clean, production-ready WebRTC multi-peer mesh system supporting Teacher & Student roles.
 * Full media permission fallbacks, unified signaling (JOIN, LEAVE, OFFER, ANSWER, CANDIDATE),
 * candidate queueing, dynamic DOM card creation, and room teardown.
 */

class WebRTCManager {
    constructor() {
        this.peers = {}; // targetUserId -> { pc, remoteStream, iceCandidatesQueue }
        this.localStream = null;
        this.localScreenStream = null;
        this.audioContext = null;
        this.analyser = null;
        this.speakingInterval = null;

        // Diagnostics & Live State
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

        // Production STUN & TURN Servers for Mobile 4G/5G Carrier & Strict NAT Traversal
        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:relay.metered.ca:80' },
                { urls: 'turn:relay.metered.ca:80', username: 'b87b7a66f443725b820fb724', credential: 'pZ+7kC4bM92h9K0/' },
                { urls: 'turn:relay.metered.ca:443', username: 'b87b7a66f443725b820fb724', credential: 'pZ+7kC4bM92h9K0/' },
                { urls: 'turn:relay.metered.ca:443?transport=tcp', username: 'b87b7a66f443725b820fb724', credential: 'pZ+7kC4bM92h9K0/' },
                { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
                { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
            ],
            iceCandidatePoolSize: 10
        };
    }

    /**
     * Request Camera & Microphone Media Stream with Robust Fallbacks
     */
    async requestMediaPermissions() {
        return this.initLocalMedia(null);
    }

    async initLocalMedia(videoElemId, speakingCallback = null, audioDeviceId = null, videoDeviceId = null) {
        console.log('[MEDIA] Live class initialization started');
        const hasMedia = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        console.log(`[MEDIA] navigator.mediaDevices: ${hasMedia}`);
        this.checkPermissionsStatus();

        if (!hasMedia) {
            const isSecure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
            console.error('[MEDIA] getUserMedia unavailable. Secure Context:', isSecure);
            this.debugState.cameraPermission = 'UNSUPPORTED / HTTP 🔴';
            this.debugState.micPermission = 'UNSUPPORTED / HTTP 🔴';
            this.updateDebugPanel();
            this.showUIMediaError('SecurityError', 'Camera and microphone access requires an HTTPS secure connection.');
            return null;
        }

        console.log('[MEDIA] Requesting camera and microphone');

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

        try {
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (primaryErr) {
                console.warn('[MEDIA] Ideal constraints failed, trying basic video+audio request:', primaryErr);
                try {
                    this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                } catch (secondaryErr) {
                    console.warn('[MEDIA] Basic video+audio failed, trying audio-only fallback:', secondaryErr);
                    try {
                        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    } catch (audioErr) {
                        console.warn('[MEDIA] Audio-only failed, trying video-only fallback:', audioErr);
                        this.localStream = await navigator.mediaDevices.getUserMedia({ video: true });
                    }
                }
            }

            console.log('[MEDIA] getUserMedia success');

            window.localStream = this.localStream;
            window.webrtc.localStream = this.localStream;
            if (window.WebRTCManager) window.WebRTCManager.localStream = this.localStream;

            const vTracks = this.localStream.getVideoTracks();
            const aTracks = this.localStream.getAudioTracks();

            console.log(`[MEDIA] Video tracks: ${vTracks.length}`);
            console.log(`[MEDIA] Audio tracks: ${aTracks.length}`);
            console.log(`[MEDIA] Local stream created. Stream ID: ${this.localStream.id}`);

            this.debugState.cameraPermission = vTracks.length > 0 ? 'GRANTED 🟢' : 'NO CAM 🟡';
            this.debugState.micPermission = aTracks.length > 0 ? 'GRANTED 🟢' : 'NO MIC 🟡';
            this.debugState.localVideoTracks = vTracks.length;
            this.debugState.localAudioTracks = aTracks.length;
            this.updateDebugPanel();

            // Bind Local Preview Stream to Video Element (Muted to prevent acoustic loop)
            if (videoElemId) {
                const localVideo = document.getElementById(videoElemId);
                if (localVideo) {
                    console.log(`[MEDIA] Local video element found: #${videoElemId}`);
                    localVideo.srcObject = this.localStream;
                    console.log('[MEDIA] Local stream assigned to video');
                    localVideo.muted = true;
                    localVideo.setAttribute('autoplay', '');
                    localVideo.setAttribute('playsinline', '');
                    localVideo.setAttribute('webkit-playsinline', '');
                    try {
                        await localVideo.play();
                    } catch (e) {
                        console.warn('[MEDIA] Local video play notice:', e);
                    }
                } else {
                    console.warn(`[MEDIA] Local video element NOT found: #${videoElemId}`);
                }
            }

            // Re-attach local tracks to any existing active RTCPeerConnections
            if (this.peers) {
                Object.values(this.peers).forEach(peerObj => {
                    if (peerObj && peerObj.pc) {
                        const senders = peerObj.pc.getSenders();
                        this.localStream.getTracks().forEach(track => {
                            if (!senders.some(s => s.track && s.track.kind === track.kind)) {
                                try {
                                    peerObj.pc.addTrack(track, this.localStream);
                                    console.log('[WEBRTC] Added local tracks');
                                } catch(e) {}
                            }
                        });
                    }
                });
            }

            if (typeof speakingCallback === 'function') {
                this.setupAudioAnalyzer(speakingCallback);
            }

            return this.localStream;
        } catch (err) {
            console.error(`[MEDIA] getUserMedia failed. Name: ${err.name}, Message: ${err.message}`, err);

            let userMsg = 'Unable to access camera/microphone.';
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                userMsg = 'Camera and microphone permission denied. Please allow camera & microphone access in your browser address bar.';
                this.debugState.cameraPermission = 'DENIED 🔴';
                this.debugState.micPermission = 'DENIED 🔴';
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                userMsg = 'No camera or microphone hardware found on this device.';
                this.debugState.cameraPermission = 'NOT FOUND 🔴';
                this.debugState.micPermission = 'NOT FOUND 🔴';
            } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                userMsg = 'Camera or microphone is already in use by another application (e.g., Zoom, Teams, Skype).';
                this.debugState.cameraPermission = 'HARDWARE BUSY 🔴';
                this.debugState.micPermission = 'HARDWARE BUSY 🔴';
            } else if (err.name === 'OverconstrainedError') {
                userMsg = 'Your camera does not support the requested video resolution/constraints.';
                this.debugState.cameraPermission = 'OVERCONSTRAINED 🔴';
                this.debugState.micPermission = 'OVERCONSTRAINED 🔴';
            } else if (err.name === 'SecurityError') {
                userMsg = 'Camera access blocked due to insecure HTTP connection. HTTPS is required.';
                this.debugState.cameraPermission = 'SECURITY ERROR 🔴';
                this.debugState.micPermission = 'SECURITY ERROR 🔴';
            } else {
                this.debugState.cameraPermission = 'ERROR 🔴';
                this.debugState.micPermission = 'ERROR 🔴';
            }

            this.updateDebugPanel();
            this.showUIMediaError(err.name, userMsg);
            return null;
        }
    }

    showUIMediaError(errorName, errorMessage) {
        const container = document.getElementById('mediaErrorAlertContainer') || document.getElementById('mobileHttpsNoticeBanner');
        if (container) {
            container.style.setProperty('display', 'flex', 'important');
            container.innerHTML = `
                <div class="alert alert-danger alert-dismissible fade show w-100 m-0 shadow" role="alert">
                    <strong><i class="fa-solid fa-triangle-exclamation me-2"></i> Media Permission Error (${errorName}):</strong> ${errorMessage}
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                </div>
            `;
        }
    }

    async checkPermissionsStatus() {
        if (navigator.permissions && navigator.permissions.query) {
            try {
                const camPerm = await navigator.permissions.query({ name: 'camera' });
                const micPerm = await navigator.permissions.query({ name: 'microphone' });
                console.log(`[WEBRTC] Permissions API: Camera: ${camPerm.state}, Mic: ${micPerm.state}`);
            } catch (e) {}
        }
    }

    /**
     * Mic & Camera Toggles
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
            console.warn('[WEBRTC] Audio Analyzer Warning:', e);
        }
    }

    /**
     * Create RTCPeerConnection for Remote Peer
     */
    async connectToPeer(targetUserId, classId, remoteVideoElemId = null, isInitiator = false) {
        if (this.peers[targetUserId]) {
            const existingPc = this.peers[targetUserId].pc;
            if (this.localStream && existingPc) {
                const senders = existingPc.getSenders();
                this.localStream.getTracks().forEach(track => {
                    if (!senders.some(s => s.track && s.track.kind === track.kind)) {
                        try {
                            existingPc.addTrack(track, this.localStream);
                            console.log('[WEBRTC] Added local tracks');
                        } catch(e) {}
                    }
                });
            }
            return this.peers[targetUserId];
        }

        console.log('[MEDIA] Creating WebRTC peer connection');
        console.log(`[SIGNAL] Creating RTCPeerConnection for Peer #${targetUserId} (Initiator: ${isInitiator})...`);
        const pc = new RTCPeerConnection(this.iceServers);

        const peerObj = {
            pc: pc,
            targetUserId: targetUserId,
            remoteStream: new MediaStream(),
            iceCandidatesQueue: []
        };
        this.peers[targetUserId] = peerObj;

        // Attach local stream tracks to RTCPeerConnection
        const streamToSend = this.localStream || window.localStream;
        if (streamToSend) {
            streamToSend.getTracks().forEach(track => {
                try {
                    pc.addTrack(track, streamToSend);
                    console.log('[WEBRTC] Added local tracks');
                } catch(e) {}
            });
        }

        pc.onconnectionstatechange = () => {
            console.log(`[WEBRTC] Connection state: ${pc.connectionState}`);
            this.debugState.peerState = pc.connectionState.toUpperCase() === 'CONNECTED' ? 'CONNECTED 🟢' : pc.connectionState.toUpperCase();
            this.updateDebugPanel();

            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                console.warn(`[WEBRTC] Connection lost with Peer #${targetUserId}. Triggering ICE restart...`);
                setTimeout(() => {
                    if (pc.restartIce) pc.restartIce();
                }, 2000);
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`[WEBRTC] ICE connection state: ${pc.iceConnectionState}`);
            this.debugState.iceState = pc.iceConnectionState.toUpperCase() === 'CONNECTED' || pc.iceConnectionState.toUpperCase() === 'COMPLETED' ? 'CONNECTED 🟢' : pc.iceConnectionState.toUpperCase();
            this.updateDebugPanel();
        };

        // ICE Candidate Generation
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[SIGNAL] ICE candidate created');
                console.log(`[SIGNAL] ICE candidate created for User #${targetUserId}`);
                const candData = event.candidate.toJSON ? event.candidate.toJSON() : event.candidate;
                this.sendSignaling(classId, targetUserId, 'candidate', candData);
                console.log('[SIGNAL] ICE candidate sent');
                console.log(`[SIGNAL] ICE candidate sent to User #${targetUserId}`);
            }
        };

        // Remote Track Reception & Audio/Video Element Binding
        pc.ontrack = (event) => {
            console.log('[WEBRTC] Remote track received');
            console.log(`[WEBRTC] Track kind: ${event.track.kind}, id: ${event.track.id} from Peer #${targetUserId}`);
            
            peerObj.remoteStream.addTrack(event.track);

            const vTracks = peerObj.remoteStream.getVideoTracks();
            const aTracks = peerObj.remoteStream.getAudioTracks();

            console.log(`[WEBRTC] Remote stream track count: ${peerObj.remoteStream.getTracks().length}`);
            console.log(`[WEBRTC] Remote video track present: ${vTracks.length > 0}`);
            console.log(`[WEBRTC] Remote audio track present: ${aTracks.length > 0}`);

            this.debugState.remoteVideoTracks = vTracks.length;
            this.debugState.remoteAudioTracks = aTracks.length;
            this.updateDebugPanel();

            const targetVideoId = remoteVideoElemId || `video_user_${targetUserId}`;
            const targetAvatarId = `avatar_user_${targetUserId}`;
            
            let remoteVideo = document.getElementById(targetVideoId);

            if (!remoteVideo) {
                console.warn(`[WEBRTC] Remote video element #${targetVideoId} not found in DOM! Attempting dynamic card creation...`);
                remoteVideo = this.ensureParticipantCard(targetUserId, targetVideoId);
            }

            if (remoteVideo) {
                console.log(`[WEBRTC] Remote video element found: #${targetVideoId}`);

                remoteVideo.srcObject = peerObj.remoteStream;
                console.log(`[WEBRTC] video.srcObject assigned for #${targetVideoId}`);

                // Remote Audio MUST be audible (muted = false)
                remoteVideo.muted = false;
                remoteVideo.setAttribute('autoplay', '');
                remoteVideo.setAttribute('playsinline', '');
                remoteVideo.setAttribute('webkit-playsinline', '');
                remoteVideo.style.display = 'block';

                const remoteAvatar = document.getElementById(targetAvatarId);
                if (remoteAvatar) remoteAvatar.style.display = 'none';

                const playPromise = remoteVideo.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        console.log(`[WEBRTC] video.play() success for #${targetVideoId}`);
                    }).catch(err => {
                        console.error(`[WEBRTC] video.play() error for #${targetVideoId}:`, err);
                        
                        const enableAudioTouch = () => {
                            remoteVideo.play()
                                .then(() => console.log(`[WEBRTC] video.play() user interaction success for #${targetVideoId}`))
                                .catch(e => console.error(`[WEBRTC] video.play() retry failed for #${targetVideoId}:`, e));
                            document.removeEventListener('touchstart', enableAudioTouch);
                            document.removeEventListener('click', enableAudioTouch);
                        };
                        document.addEventListener('touchstart', enableAudioTouch, { once: true });
                        document.addEventListener('click', enableAudioTouch, { once: true });
                    });
                }
            } else {
                console.error(`[WEBRTC] Remote video element not found: #${targetVideoId}`);
            }
        };

        // SDP Offer Generation for Initiator
        if (isInitiator) {
            try {
                const offerOptions = { offerToReceiveAudio: true, offerToReceiveVideo: true };
                console.log('[SIGNAL] OFFER created');
                console.log(`[SIGNAL] OFFER created for User #${targetUserId}`);
                const offer = await pc.createOffer(offerOptions);
                await pc.setLocalDescription(offer);
                console.log('[SIGNAL] OFFER sent');
                console.log(`[SIGNAL] OFFER sent to User #${targetUserId}`);
                this.sendSignaling(classId, targetUserId, 'offer', offer);
            } catch (e) {
                console.error(`[WEBRTC] Offer creation error for Peer #${targetUserId}:`, e);
            }
        }

        return peerObj;
    }

    async handleSignalingData(classId, senderUserId, type, data, remoteVideoElemId = null) {
        return this.handleSignaling(classId, senderUserId, type, data, remoteVideoElemId);
    }

    /**
     * Unified Signaling Handler (JOIN, LEAVE, OFFER, ANSWER, CANDIDATE)
     */
    async handleSignaling(classId, senderUserId, type, data, remoteVideoElemId = null) {
        let normType = String(type || '').toLowerCase();
        if (normType === 'ice_candidate' || normType === 'icecandidate') normType = 'candidate';

        if (normType === 'join') {
            console.log('[SIGNAL] JOIN received');
            console.log(`[SIGNAL] JOIN received from User #${senderUserId}`);
            if (!this.peers[senderUserId]) {
                await this.connectToPeer(senderUserId, classId, remoteVideoElemId, true);
            }
            return;
        }

        if (normType === 'leave') {
            console.log(`[WEBRTC] Peer #${senderUserId} left the room. Tearing down connection...`);
            this.closePeer(senderUserId);
            return;
        }

        let peerObj = this.peers[senderUserId];
        if (!peerObj) {
            peerObj = await this.connectToPeer(senderUserId, classId, remoteVideoElemId, false);
        }

        const pc = peerObj.pc;

        try {
            let parsedData = data;
            if (typeof parsedData === 'string') {
                try { parsedData = JSON.parse(parsedData); } catch(e) {}
            }
            if (typeof parsedData === 'string') {
                try { parsedData = JSON.parse(parsedData); } catch(e) {}
            }

            // Extract SDP object if wrapped
            let sdpObj = parsedData;
            if (parsedData && typeof parsedData === 'object') {
                if (parsedData.payload && typeof parsedData.payload === 'object') {
                    sdpObj = parsedData.payload;
                } else if (parsedData.offer && typeof parsedData.offer === 'object') {
                    sdpObj = parsedData.offer;
                } else if (parsedData.answer && typeof parsedData.answer === 'object') {
                    sdpObj = parsedData.answer;
                }
            }

            if (normType === 'offer') {
                console.log('[SIGNAL] OFFER received');
                console.log(`[SIGNAL] OFFER received from User #${senderUserId}`);

                if (sdpObj && typeof sdpObj === 'object' && !sdpObj.type) {
                    sdpObj.type = 'offer';
                }

                // 1. setRemoteDescription(offer)
                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(sdpObj));
                    console.log('[SIGNAL] Remote description set');
                    console.log(`[SIGNAL] Remote description set (OFFER) for User #${senderUserId}`);
                } catch (err) {
                    console.error(`setRemoteDescription error for OFFER from Peer #${senderUserId}:`, err);
                    throw err;
                }

                // Flush queued ICE candidates
                if (peerObj.iceCandidatesQueue && peerObj.iceCandidatesQueue.length > 0) {
                    for (const cand of peerObj.iceCandidatesQueue) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(cand));
                            console.log('[SIGNAL] ICE candidate added');
                            console.log(`[SIGNAL] ICE candidate added for User #${senderUserId}`);
                        } catch(e) {}
                    }
                    peerObj.iceCandidatesQueue = [];
                }

                // 2. createAnswer()
                let answer;
                try {
                    console.log('[SIGNAL] ANSWER created');
                    console.log(`[SIGNAL] ANSWER created for User #${senderUserId}`);
                    const answerOptions = { offerToReceiveAudio: true, offerToReceiveVideo: true };
                    answer = await pc.createAnswer(answerOptions);
                } catch (err) {
                    console.error(`createAnswer error for Peer #${senderUserId}:`, err);
                    throw err;
                }

                // 3. setLocalDescription(answer)
                try {
                    await pc.setLocalDescription(answer);
                    console.log(`setLocalDescription success for Peer #${senderUserId}`);
                } catch (err) {
                    console.error(`setLocalDescription error for Peer #${senderUserId}:`, err);
                    throw err;
                }

                // 4. POST answer to /api/webrtc/signal
                try {
                    console.log('[SIGNAL] ANSWER sent');
                    console.log(`[SIGNAL] ANSWER sent to User #${senderUserId}`);
                    await this.sendSignaling(classId, senderUserId, 'answer', answer);
                } catch (err) {
                    console.error(`fetch POST error sending ANSWER to Peer #${senderUserId}:`, err);
                    throw err;
                }

            } else if (normType === 'answer') {
                console.log('[SIGNAL] ANSWER received');
                console.log(`[SIGNAL] ANSWER received from User #${senderUserId}`);

                if (sdpObj && typeof sdpObj === 'object' && !sdpObj.type) {
                    sdpObj.type = 'answer';
                }

                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(sdpObj));
                    console.log('[SIGNAL] Remote description set');
                    console.log(`[SIGNAL] Remote description set (ANSWER) for User #${senderUserId}`);
                } catch (err) {
                    console.error(`setRemoteDescription error for ANSWER from Peer #${senderUserId}:`, err);
                    throw err;
                }

                // Flush queued ICE candidates
                if (peerObj.iceCandidatesQueue && peerObj.iceCandidatesQueue.length > 0) {
                    for (const cand of peerObj.iceCandidatesQueue) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(cand));
                            console.log('[SIGNAL] ICE candidate added');
                            console.log(`[SIGNAL] ICE candidate added for User #${senderUserId}`);
                        } catch(e) {}
                    }
                    peerObj.iceCandidatesQueue = [];
                }

                console.log(`[WEBRTC] P2P SDP Handshake Complete for Peer #${senderUserId}`);

            } else if (normType === 'candidate') {
                console.log('[SIGNAL] ICE candidate received');
                console.log(`[SIGNAL] ICE candidate received from User #${senderUserId}`);
                let candObj = sdpObj;
                if (candObj && typeof candObj === 'object') {
                    if (candObj.candidate && typeof candObj.candidate === 'object') {
                        candObj = candObj.candidate;
                    }
                }

                if (pc.remoteDescription && pc.remoteDescription.type) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(candObj));
                        console.log('[SIGNAL] ICE candidate added');
                        console.log(`[SIGNAL] ICE candidate added for User #${senderUserId}`);
                    } catch (err) {
                        console.error(`addIceCandidate error from Peer #${senderUserId}:`, err);
                    }
                } else {
                    console.log(`[WEBRTC] Remote description not set yet for Peer #${senderUserId}, queuing candidate...`);
                    if (!peerObj.iceCandidatesQueue) peerObj.iceCandidatesQueue = [];
                    peerObj.iceCandidatesQueue.push(candObj);
                }
            }
        } catch (e) {
            console.error(`[WEBRTC] Failed processing ${normType} signal from Peer #${senderUserId}:`, e);
        }
    }

    /**
     * Transmit Signaling Message to Server
     */
    async sendSignaling(classId, targetUserId, signalType, payload) {
        try {
            if (signalType === 'join') {
                console.log('[SIGNAL] JOIN sent');
            }
            console.log(`[WEBRTC] Sending ${signalType} to Target User #${targetUserId}`);
            const response = await fetch('/api/webrtc/signal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    class_id: classId,
                    target_user_id: targetUserId,
                    to_user_id: targetUserId,
                    action: signalType,
                    signal_type: signalType,
                    payload: payload,
                    data: payload
                })
            });
            if (!response.ok) {
                console.error(`fetch POST error sending ${signalType}: HTTP ${response.status}`);
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (e) {
            console.error(`fetch POST error sending ${signalType}:`, e);
            throw e;
        }
    }

    /**
     * Dynamic Participant Card Generator in DOM
     */
    ensureParticipantCard(targetUserId, targetVideoId = null) {
        const vId = targetVideoId || `video_user_${targetUserId}`;
        let remoteVideo = document.getElementById(vId);
        if (remoteVideo) return remoteVideo;

        const grid = document.getElementById('classParticipantGrid');
        if (!grid) {
            console.error(`[WEBRTC] #classParticipantGrid container not found in DOM!`);
            return null;
        }

        const col = document.createElement('div');
        col.className = 'col-md-4 col-6';
        col.id = `col_user_${targetUserId}`;
        col.innerHTML = `
            <div class="participant-grid-card p-2 text-center" id="card_user_${targetUserId}">
                <span id="badge_speaking_${targetUserId}" class="badge bg-success position-absolute top-0 start-0 m-2" style="display: none; z-index: 10;">🟢 SPEAKING</span>
                <video id="${vId}" autoplay playsinline class="live-video-elem" style="display: block; width: 100%; height: 145px; object-fit: cover; border-radius: 10px;"></video>
                <div id="avatar_user_${targetUserId}" class="participant-avatar-placeholder" style="display: none;">
                    U${targetUserId}
                </div>
                <div class="px-2 mt-1">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="fw-bold text-white small text-truncate">Participant #${targetUserId}</span>
                        <span class="badge bg-success" style="font-size: 0.6rem;">🟢 ACTIVE</span>
                    </div>
                    <div class="d-flex justify-content-between align-items-center mb-1" style="font-size: 0.65rem;">
                        <span id="badge_cam_${targetUserId}" class="badge bg-success">📹 Cam ON</span>
                        <span id="badge_mic_${targetUserId}" class="badge bg-success">🟢 MIC ON</span>
                    </div>
                </div>
            </div>
        `;
        grid.appendChild(col);

        remoteVideo = document.getElementById(vId);
        if (remoteVideo) {
            console.log(`[WEBRTC] Dynamically created video element #${vId} in #classParticipantGrid`);
        }
        return remoteVideo;
    }

    /**
     * Screen Sharing
     */
    async startScreenShare(classId, targetVideoId) {
        try {
            console.log('[WEBRTC] Requesting Screen Stream...');
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
            console.error('[WEBRTC] Screen sharing error:', err);
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

    viewStudentScreenStream(examId, studentId, videoElem, badgeElem) {
        if (!videoElem) return;
        videoElem.style.display = 'block';
        if (badgeElem) badgeElem.innerHTML = '<span class="badge bg-success mb-1">🟢 LIVE WEBRTC SCREEN STREAM</span>';
    }

    /**
     * Close Connection for Single Peer
     */
    closePeer(userId) {
        if (this.peers[userId]) {
            try {
                this.peers[userId].pc.close();
            } catch (e) {}
            delete this.peers[userId];
        }

        const col = document.getElementById(`col_user_${userId}`);
        if (col) col.remove();
        console.log(`[WEBRTC] Teardown complete for Peer #${userId}`);
    }

    /**
     * Complete Room Teardown
     */
    async leaveRoom(classId) {
        console.log('[WEBRTC] Leaving room and tearing down all peer connections...');
        try {
            await this.sendSignaling(classId, null, 'leave', { room_left: true });
        } catch (e) {}

        Object.keys(this.peers).forEach(userId => {
            this.closePeer(userId);
        });

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        if (this.localScreenStream) {
            this.localScreenStream.getTracks().forEach(track => track.stop());
            this.localScreenStream = null;
        }

        if (this.audioContext) {
            try { this.audioContext.close(); } catch(e) {}
            this.audioContext = null;
        }

        this.debugState.localVideoTracks = 0;
        this.debugState.localAudioTracks = 0;
        this.debugState.peerState = 'DISCONNECTED 🔴';
        this.updateDebugPanel();
    }

    updateDebugPanel() {
        const setTxt = (id, altId, val) => {
            const el = document.getElementById(id) || document.getElementById(altId);
            if (el) el.innerText = val;
        };

        setTxt('dbgHttps', 'dbg_is_https', this.debugState.isHttps);
        setTxt('dbgSecureContext', 'dbg_is_secure', this.debugState.isSecureContext);
        setTxt('dbgCamPerm', 'dbg_cam_perm', this.debugState.cameraPermission);
        setTxt('dbgMicPerm', 'dbg_mic_perm', this.debugState.micPermission);
        setTxt('dbgLocalVideoTracks', 'dbg_loc_vid', this.debugState.localVideoTracks);
        setTxt('dbgLocalAudioTracks', 'dbg_loc_aud', this.debugState.localAudioTracks);
        setTxt('dbgPeerState', 'dbg_peer_state', this.debugState.peerState);
        setTxt('dbgIceState', 'dbg_ice_state', this.debugState.iceState);
        setTxt('dbgRemoteVideoTracks', 'dbg_rem_vid', this.debugState.remoteVideoTracks);
        setTxt('dbgRemoteAudioTracks', 'dbg_rem_aud', this.debugState.remoteAudioTracks);
    }
}

// Instantiate default singleton instance
const defaultWebRTC = new WebRTCManager();
window.webrtc = defaultWebRTC;

// Static proxy delegators on WebRTCManager class for seamless static calling
WebRTCManager.initLocalMedia = function(...args) { return defaultWebRTC.initLocalMedia(...args); };
WebRTCManager.connectToPeer = function(...args) { return defaultWebRTC.connectToPeer(...args); };
WebRTCManager.handleSignaling = function(...args) { return defaultWebRTC.handleSignaling(...args); };
WebRTCManager.handleSignalingData = function(...args) { return defaultWebRTC.handleSignalingData(...args); };
WebRTCManager.toggleCamera = function(...args) { return defaultWebRTC.toggleCamera(...args); };
WebRTCManager.toggleMicrophone = function(...args) { return defaultWebRTC.toggleMicrophone(...args); };
WebRTCManager.startScreenShare = function(...args) { return defaultWebRTC.startScreenShare(...args); };
WebRTCManager.stopScreenShare = function(...args) { return defaultWebRTC.stopScreenShare(...args); };
WebRTCManager.viewStudentScreenStream = function(...args) { return defaultWebRTC.viewStudentScreenStream(...args); };
WebRTCManager.leaveRoom = function(...args) { return defaultWebRTC.leaveRoom(...args); };

window.WebRTCManager = WebRTCManager;
