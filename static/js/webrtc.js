/**
 * SmartExam Production WebRTC Engine (Laptop & Mobile Cross-Platform)
 * Step-by-step media access, RTCPeerConnection management, STUN/TURN support,
 * SDP Offer/Answer flow, ICE candidate exchange, remote audio/video binding.
 */

class WebRTCManager {
    constructor() {
        async requestMediaPermissions() {
    try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        this.debugState.cameraPermission = 'GRANTED';
        this.debugState.micPermission = 'GRANTED';
        this.debugState.localVideoTracks =
            this.localStream.getVideoTracks().length;
        this.debugState.localAudioTracks =
            this.localStream.getAudioTracks().length;

        console.log('Camera and microphone started');
        return this.localStream;

    } catch (error) {
        console.error('Media error:', error);

        this.debugState.cameraPermission = 'DENIED';
        this.debugState.micPermission = 'DENIED';
    }
}
        this.peers = {}; // targetUserId -> { pc, remoteStream }
        this.localStream = null;
        this.localScreenStream = null;
        this.audioContext = null;
        this.analyser = null;
        this.speakingInterval = null;

        // Diagnostics
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

        // STUN + Production TURN Servers for Mobile 4G/5G Carrier & Strict NAT Traversal
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
            ]
        };
    }

    /**
     * STEP 1: MEDIA ACCESS - Request Camera & Microphone Stream
     */
    async initLocalMedia(videoElemId, speakingCallback = null, audioDeviceId = null, videoDeviceId = null) {
        console.log('[WebRTC]: getUserMedia started');
        this.checkPermissionsStatus();

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
                console.warn('[WebRTC]: Ideal constraints failed, trying basic video+audio request:', primaryErr);
                try {
                    this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                } catch (secondaryErr) {
                    console.warn('[WebRTC]: Basic video+audio failed, trying audio-only fallback:', secondaryErr);
                    try {
                        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    } catch (audioErr) {
                        console.warn('[WebRTC]: Audio-only failed, trying video-only fallback:', audioErr);
                        this.localStream = await navigator.mediaDevices.getUserMedia({ video: true });
                    }
                }
            }

            // Save stream globally for debugging and accessibility
            window.localStream = this.localStream;
            window.webrtc.localStream = this.localStream;
            if (window.WebRTCManager) window.WebRTCManager.localStream = this.localStream;

            const vTracks = this.localStream.getVideoTracks();
            const aTracks = this.localStream.getAudioTracks();

            console.log('[WebRTC]: getUserMedia success');
            console.log(`[WebRTC]: Local Stream ID: ${this.localStream.id}`);
            console.log(`[WebRTC]: Track count: Video: ${vTracks.length}, Audio: ${aTracks.length}`);
            console.log('[WebRTC]: Permission status: Camera GRANTED, Mic GRANTED');

            this.debugState.cameraPermission = vTracks.length > 0 ? 'GRANTED 🟢' : 'NO CAM 🟡';
            this.debugState.micPermission = aTracks.length > 0 ? 'GRANTED 🟢' : 'NO MIC 🟡';
            this.debugState.localVideoTracks = vTracks.length;
            this.debugState.localAudioTracks = aTracks.length;
            this.updateDebugPanel();

            // STEP 3: Attach Local Stream to Video Element
            const localVideo = document.getElementById(videoElemId);
            if (localVideo) {
                localVideo.srcObject = this.localStream;
                localVideo.muted = true; // Local preview MUST be muted to prevent acoustic feedback loop
                localVideo.setAttribute('autoplay', '');
                localVideo.setAttribute('playsinline', '');
                localVideo.setAttribute('webkit-playsinline', '');
                try {
                    await localVideo.play();
                    console.log(`[WebRTC STEP 3 SUCCESS]: Attached local stream to video element #${videoElemId}`);
                } catch (e) {
                    console.warn(`[WebRTC STEP 3 WARNING]: Local video play notice:`, e);
                }
            }

            // Re-attach local tracks to any existing RTCPeerConnections
            if (this.peers) {
                Object.values(this.peers).forEach(peerObj => {
                    if (peerObj && peerObj.pc) {
                        const senders = peerObj.pc.getSenders();
                        this.localStream.getTracks().forEach(track => {
                            if (!senders.some(s => s.track && s.track.kind === track.kind)) {
                                try { peerObj.pc.addTrack(track, this.localStream); } catch(e) {}
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
            console.error('[WebRTC]: getUserMedia failed or denied:', err);
            const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
            const isNotFound = err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError';

            this.debugState.cameraPermission = isDenied ? 'DENIED 🔴' : (isNotFound ? 'NOT FOUND 🔴' : 'ERROR 🔴');
            this.debugState.micPermission = isDenied ? 'DENIED 🔴' : (isNotFound ? 'NOT FOUND 🔴' : 'ERROR 🔴');
            this.updateDebugPanel();

            console.warn(`[WebRTC Permissions Notice]: ${err.name}: ${err.message}. Waiting for user gesture click on Camera/Mic buttons.`);
            return null;
        }
    }

    async checkPermissionsStatus() {
        if (navigator.permissions && navigator.permissions.query) {
            try {
                const camPerm = await navigator.permissions.query({ name: 'camera' });
                const micPerm = await navigator.permissions.query({ name: 'microphone' });
                console.log(`[WebRTC Permissions API]: Camera status: ${camPerm.state}, Mic status: ${micPerm.state}`);
            } catch (e) {
                // Ignore permissions query API unsupported errors
            }
        }
    }

    /**
     * Toggles
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
            console.warn('[WebRTC Audio Analyzer Warning]:', e);
        }
    }

    /**
     * STEP 2, 3, 5, 6, 7: RTCPeerConnection Setup & Media Track Binding
     */
    /**
     * STEP 2, 3, 5, 6, 7: RTCPeerConnection Setup & Media Track Binding
     */
    async connectToPeer(targetUserId, classId, remoteVideoElemId = null, isInitiator = false) {
        if (this.peers[targetUserId]) {
            // Ensure local tracks are attached if localStream became available after peer creation
            const existingPc = this.peers[targetUserId].pc;
            if (this.localStream && existingPc) {
                const senders = existingPc.getSenders();
                this.localStream.getTracks().forEach(track => {
                    if (!senders.some(s => s.track && s.track.kind === track.kind)) {
                        try { existingPc.addTrack(track, this.localStream); } catch(e) {}
                    }
                });
            }
            return this.peers[targetUserId];
        }

        console.log(`[WebRTC STEP 2 - PEER CONNECTION]: Creating RTCPeerConnection for User #${targetUserId} (Initiator: ${isInitiator})...`);
        const pc = new RTCPeerConnection(this.iceServers);

        const peerObj = {
            pc: pc,
            targetUserId: targetUserId,
            remoteStream: new MediaStream()
        };
        this.peers[targetUserId] = peerObj;

        // STEP 3: Track Sending - Attach local tracks to RTCPeerConnection
        const streamToSend = this.localStream || window.localStream;
        if (streamToSend) {
            streamToSend.getTracks().forEach(track => {
                console.log(`[WebRTC STEP 3 - TRACK SENDING]: Adding local track (${track.kind}) to Peer #${targetUserId}`);
                try { pc.addTrack(track, streamToSend); } catch(e) {}
            });
        }

        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC STEP 2 STATE]: Peer #${targetUserId} connectionState: ${pc.connectionState}`);
            this.debugState.peerState = pc.connectionState.toUpperCase() === 'CONNECTED' ? 'CONNECTED 🟢' : pc.connectionState.toUpperCase();
            this.updateDebugPanel();

            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                console.warn(`[WebRTC STEP 2 RECONNECT]: Connection lost with Peer #${targetUserId}. Triggering ICE restart...`);
                setTimeout(() => {
                    if (pc.restartIce) pc.restartIce();
                }, 2000);
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`[WebRTC STEP 6 ICE STATE]: Peer #${targetUserId} iceConnectionState: ${pc.iceConnectionState}`);
            this.debugState.iceState = pc.iceConnectionState.toUpperCase() === 'CONNECTED' || pc.iceConnectionState.toUpperCase() === 'COMPLETED' ? 'CONNECTED 🟢' : pc.iceConnectionState.toUpperCase();
            this.updateDebugPanel();
        };

        // STEP 6: ICE Candidates Generation
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`[WebRTC STEP 6 - ICE GENERATED]: Sending ICE candidate to Peer #${targetUserId}`, event.candidate);
                this.sendSignaling(classId, targetUserId, 'candidate', event.candidate);
            }
        };

        // STEP 7 & STEP 8: Remote Track Reception & Audio Unmuting
        pc.ontrack = (event) => {
            console.log(`[WebRTC STEP 7 & 8 - REMOTE TRACK RECEIVED]: Received remote track (${event.track.kind}) from Peer #${targetUserId}`);
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
                // STEP 8: REMOTE AUDIO MUST BE AUDIBLE (muted = false!)
                remoteVideo.muted = false;
                // STEP 9 & 10: Android Chrome Mobile Browser Attributes
                remoteVideo.setAttribute('autoplay', '');
                remoteVideo.setAttribute('playsinline', '');
                remoteVideo.setAttribute('webkit-playsinline', '');
                remoteVideo.style.display = 'block';
                if (remoteAvatar) remoteAvatar.style.display = 'none';

                console.log(`[WebRTC STEP 7 & 8 SUCCESS]: Bound remote MediaStream (Audio+Video) to #${targetVideoId}. Muted: false`);

                // Android Chrome Autoplay Promise Catch Handler & User Touch Interaction Unblocker
                const playPromise = remoteVideo.play();
                if (playPromise !== undefined) {
                    playPromise.catch(err => {
                        console.warn(`[WebRTC Android Autoplay Warning]: Remote playback pending user interaction for #${targetVideoId}:`, err);
                        const enableAudioTouch = () => {
                            remoteVideo.play().catch(e => {});
                            document.removeEventListener('touchstart', enableAudioTouch);
                            document.removeEventListener('click', enableAudioTouch);
                        };
                        document.addEventListener('touchstart', enableAudioTouch, { once: true });
                        document.addEventListener('click', enableAudioTouch, { once: true });
                    });
                }
            }
        };

        // STEP 5: SDP Offer Generation
        if (isInitiator) {
            try {
                const offerOptions = { offerToReceiveAudio: true, offerToReceiveVideo: true };
                const offer = await pc.createOffer(offerOptions);
                await pc.setLocalDescription(offer);
                console.log(`[WebRTC STEP 5 - SDP OFFER GENERATED]: Sending offer to Peer #${targetUserId}`, offer);
                this.sendSignaling(classId, targetUserId, 'offer', offer);
            } catch (e) {
                console.error(`[WebRTC STEP 5 ERROR]: Offer creation failed for Peer #${targetUserId}:`, e);
            }
        }

        return peerObj;
    }

    async handleSignalingData(classId, senderUserId, type, data, remoteVideoElemId = null) {
        return this.handleSignaling(classId, senderUserId, type, data, remoteVideoElemId);
    }

    /**
     * STEP 5 & STEP 6: Receive Signaling Messages (Offer, Answer, Candidate)
     */
    async handleSignaling(classId, senderUserId, type, data, remoteVideoElemId = null) {
        let peerObj = this.peers[senderUserId];
        if (!peerObj) {
            peerObj = await this.connectToPeer(senderUserId, classId, remoteVideoElemId, false);
        }

        const pc = peerObj.pc;

        try {
            let parsedData = data;
            if (typeof data === 'string') {
                try { parsedData = JSON.parse(data); } catch(e) {}
            }

            if (type === 'offer') {
                console.log(`[WebRTC STEP 5 - SDP OFFER RECEIVED]: Received offer from Peer #${senderUserId}. Setting remote description & creating Answer...`);
                await pc.setRemoteDescription(new RTCSessionDescription(parsedData));

                // Flush queued ICE candidates
                if (peerObj.iceCandidatesQueue && peerObj.iceCandidatesQueue.length > 0) {
                    for (const cand of peerObj.iceCandidatesQueue) {
                        try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(e) {}
                    }
                    peerObj.iceCandidatesQueue = [];
                }

                const answerOptions = { offerToReceiveAudio: true, offerToReceiveVideo: true };
                const answer = await pc.createAnswer(answerOptions);
                await pc.setLocalDescription(answer);
                console.log(`[WebRTC STEP 5 - SDP ANSWER GENERATED]: Sending answer to Peer #${senderUserId}`, answer);
                this.sendSignaling(classId, senderUserId, 'answer', answer);
            } else if (type === 'answer') {
                console.log(`[WebRTC STEP 5 - SDP ANSWER RECEIVED]: Received answer from Peer #${senderUserId}. Setting remote description...`);
                await pc.setRemoteDescription(new RTCSessionDescription(parsedData));

                // Flush queued ICE candidates
                if (peerObj.iceCandidatesQueue && peerObj.iceCandidatesQueue.length > 0) {
                    for (const cand of peerObj.iceCandidatesQueue) {
                        try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(e) {}
                    }
                    peerObj.iceCandidatesQueue = [];
                }

                console.log(`[WebRTC STEP 5 SUCCESS]: P2P SDP Handshake Complete for Peer #${senderUserId}`);
            } else if (type === 'candidate') {
                if (pc.remoteDescription && pc.remoteDescription.type) {
                    console.log(`[WebRTC STEP 6 - ICE CANDIDATE RECEIVED]: Adding ICE candidate from Peer #${senderUserId}`);
                    await pc.addIceCandidate(new RTCIceCandidate(parsedData));
                } else {
                    console.log(`[WebRTC STEP 6 - ICE CANDIDATE QUEUED]: Remote description not set yet for Peer #${senderUserId}, queuing candidate...`);
                    if (!peerObj.iceCandidatesQueue) peerObj.iceCandidatesQueue = [];
                    peerObj.iceCandidatesQueue.push(parsedData);
                }
            }
        } catch (e) {
            console.error(`[WebRTC STEP 5/6 ERROR]: Failed processing ${type} signal from Peer #${senderUserId}:`, e);
        }
    }

    /**
     * STEP 4: Transmit Signaling Message to Server
     */
    async sendSignaling(classId, targetUserId, signalType, payload) {
        try {
            console.log(`[WebRTC STEP 4 - SIGNAL TRANSMISSION]: Sending ${signalType} to Target User #${targetUserId}`);
            await fetch('/api/webrtc/signal', {
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
        } catch (e) {
            console.error('[WebRTC STEP 4 ERROR]: Signaling POST failed:', e);
        }
    }

    /**
     * Screen Sharing
     */
    async startScreenShare(classId, targetVideoId) {
        try {
            console.log('[WebRTC Screen Share]: Requesting Screen Stream...');
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
            console.error('[WebRTC Error]: Screen sharing error:', err);
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

// Instantiate default singleton instance
const defaultWebRTC = new WebRTCManager();
window.webrtc = defaultWebRTC;

defaultWebRTC.requestMediaPermissions();

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

window.WebRTCManager = WebRTCManager;
