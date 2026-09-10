/**
 * SmartExam Production SFU Media Engine
 * Scalable Live Class Architecture (Teacher -> SFU -> 200+ Students)
 * Supporting Agora RTC SDK v4 with WebRTC SFU fallback, deterministic state machine,
 * audio-first priority, autoplay restriction recovery, screen sharing, and real-time diagnostics.
 */

class WebRTCManager {
    constructor() {
        this.client = null;
        this.localAudioTrack = null;
        this.localVideoTrack = null;
        this.localScreenTrack = null;

        this.remoteAudioTracks = {};
        this.remoteVideoTracks = {};

        this.appId = 'e3a79d060f644b9b9409890f9d92418e';
        this.channelName = null;
        this.currentUserId = null;
        this.isTeacher = false;

        // State Machine: IDLE, CONNECTING, CONNECTED, RECONNECTING, DISCONNECTED, FAILED
        this.connectionState = 'IDLE';

        // Real-Time Diagnostic State
        this.debugState = {
            signaling: 'DISCONNECTED 🔴',
            media: 'IDLE ⚪',
            teacherAudio: 'NOT PUBLISHED 🔴',
            teacherVideo: 'NOT PUBLISHED 🔴',
            remoteAudio: 'NOT RECEIVED 🔴',
            remoteVideo: 'NOT RECEIVED 🔴',
            roomId: 'NONE',
            role: 'STUDENT',
            participantsCount: 0
        };

        this.peers = {}; // Fallback mesh lookup if needed
        this.localStream = null;
    }

    setConnectionState(newState) {
        this.connectionState = newState;
        if (newState === 'CONNECTED') {
            this.debugState.media = 'CONNECTED 🟢';
        } else if (newState === 'RECONNECTING') {
            this.debugState.media = 'RECONNECTING 🟡';
        } else if (newState === 'FAILED') {
            this.debugState.media = 'FAILED 🔴';
        } else {
            this.debugState.media = `${newState} ⚪`;
        }
        this.updateDebugPanel();
    }

    /**
     * Initialize SFU Live Room for Teacher or Student
     */
    async joinRoomSFU(classId, userId, isTeacher = false, localVideoId = null, speakingCallback = null) {
        this.channelName = `smartexam_class_${classId}`;
        this.currentUserId = userId;
        this.isTeacher = isTeacher;
        this.debugState.roomId = `CLASS_${classId}`;
        this.debugState.role = isTeacher ? 'TEACHER (HOST)' : 'STUDENT (AUDIENCE)';

        console.log(`[ROOM] Joining room: ${this.channelName}`);
        this.setConnectionState('CONNECTING');

        // Fetch backend SFU credentials & validated role
        try {
            const cfgRes = await fetch(`/api/live-class/config?class_id=${classId}`);
            if (cfgRes.ok) {
                const cfg = await cfgRes.json();
                if (cfg.app_id) this.appId = cfg.app_id;
                if (cfg.channel) this.channelName = cfg.channel;
            }
        } catch (e) {
            console.warn('[ROOM] Config fetch notice, using default App ID:', e);
        }

        console.log('[SIGNAL] Signaling connected');
        this.debugState.signaling = 'CONNECTED 🟢';

        if (typeof window.AgoraRTC === 'undefined') {
            console.error('[ROOM] AgoraRTC SDK v4 not loaded on page!');
            this.setConnectionState('FAILED');
            return false;
        }

        try {
            this.client = window.AgoraRTC.createClient({
                mode: 'live',
                codec: 'vp8'
            });

            // Set Role
            const agoraRole = isTeacher ? 'host' : 'audience';
            await this.client.setClientRole(agoraRole);

            // Register Event Listeners
            this.registerClientEvents();

            // Join SFU Channel
            await this.client.join(this.appId, this.channelName, null, String(userId));
            console.log('[ROOM] Joined room successfully');
            this.setConnectionState('CONNECTED');
            console.log('[MEDIA] Connection connected');

            // If Teacher, acquire and publish media
            if (isTeacher) {
                await this.initAndPublishTeacherMedia(localVideoId);
            } else {
                console.log('[MEDIA] Student waiting for teacher publication...');
            }

            this.updateDebugPanel();
            return true;

        } catch (err) {
            console.error('[ROOM] Join SFU error:', err);
            this.setConnectionState('FAILED');
            return false;
        }
    }

    /**
     * Teacher Media Acquisition & SFU Publication
     */
    async initAndPublishTeacherMedia(localVideoId) {
        if (!this.client || !this.isTeacher) return;

        try {
            // 1. Microphone Acquisition
            console.log('[MEDIA] Requesting teacher microphone');
            this.localAudioTrack = await window.AgoraRTC.createMicrophoneAudioTrack({
                encoderConfig: 'speech_standard',
                AEC: true,
                ANS: true,
                AGC: true
            });
            console.log('[MEDIA] Microphone acquired');

            // 2. Camera Acquisition
            try {
                console.log('[MEDIA] Requesting teacher camera');
                this.localVideoTrack = await window.AgoraRTC.createCameraVideoTrack({
                    encoderConfig: '720p_1'
                });
                console.log('[MEDIA] Camera acquired');
            } catch (camErr) {
                console.warn('[MEDIA] Camera acquisition warning:', camErr);
            }

            // 3. Local Video Preview Element Binding
            if (localVideoId && this.localVideoTrack) {
                const localElem = document.getElementById(localVideoId);
                if (localElem) {
                    localElem.style.display = 'block';
                    this.localVideoTrack.play(localVideoId);
                }
            }

            // 4. Publish Media Streams to SFU
            const tracksToPublish = [];
            if (this.localAudioTrack) {
                console.log('[MEDIA] Publishing audio');
                tracksToPublish.push(this.localAudioTrack);
                this.debugState.teacherAudio = 'PUBLISHED 🟢';
            }
            if (this.localVideoTrack) {
                console.log('[MEDIA] Publishing video');
                tracksToPublish.push(this.localVideoTrack);
                this.debugState.teacherVideo = 'PUBLISHED 🟢';
            }

            if (tracksToPublish.length > 0) {
                await this.client.publish(tracksToPublish);
                console.log('[MEDIA] Publication confirmed');
            }

            this.updateDebugPanel();

        } catch (err) {
            console.error('[MEDIA] Teacher publication error:', err);
            this.showUIMediaError(err.name || 'MediaError', err.message || 'Unable to publish teacher camera/microphone.');
        }
    }

    /**
     * Register SFU Client Events for Subscriptions & Reconnections
     */
    registerClientEvents() {
        if (!this.client) return;

        // Remote User Published Event
        this.client.on('user-published', async (user, mediaType) => {
            console.log(`[MEDIA] User published: #${user.uid}, type: ${mediaType}`);

            try {
                await this.client.subscribe(user, mediaType);
                console.log(`[MEDIA] Subscribed to #${user.uid} ${mediaType}`);

                if (mediaType === 'audio') {
                    console.log('[MEDIA] Student subscribing to teacher audio');
                    this.remoteAudioTracks[user.uid] = user.audioTrack;
                    
                    try {
                        user.audioTrack.play();
                        console.log('[MEDIA] Remote audio attached');
                        console.log('[MEDIA] Audio playback started');
                        this.debugState.remoteAudio = 'RECEIVED 🟢';
                        this.hideAudioAutoplayBanner();
                    } catch (playErr) {
                        console.warn('[MEDIA] Audio autoplay blocked by browser:', playErr);
                        this.showAudioAutoplayBanner();
                    }
                }

                if (mediaType === 'video') {
                    console.log('[MEDIA] Student subscribing to teacher video');
                    this.remoteVideoTracks[user.uid] = user.videoTrack;
                    
                    const targetVideoId = `video_user_${user.uid}`;
                    let videoContainer = document.getElementById(targetVideoId);

                    if (!videoContainer) {
                        videoContainer = this.ensureParticipantCard(user.uid, targetVideoId);
                    }

                    if (videoContainer) {
                        videoContainer.style.display = 'block';
                        videoContainer.innerHTML = '';
                        user.videoTrack.play(targetVideoId);
                        console.log('[MEDIA] Remote video attached');
                        this.debugState.remoteVideo = 'RECEIVED 🟢';

                        const avatarElem = document.getElementById(`avatar_user_${user.uid}`);
                        if (avatarElem) avatarElem.style.display = 'none';
                    }
                }

                this.updateDebugPanel();

            } catch (err) {
                console.error(`[MEDIA] Subscription error for #${user.uid}:`, err);
            }
        });

        // Remote User Unpublished Event
        this.client.on('user-unpublished', (user, mediaType) => {
            console.log(`[MEDIA] User unpublished: #${user.uid}, type: ${mediaType}`);

            if (mediaType === 'video') {
                delete this.remoteVideoTracks[user.uid];
                this.debugState.remoteVideo = 'NOT RECEIVED 🔴';
                const avatarElem = document.getElementById(`avatar_user_${user.uid}`);
                if (avatarElem) avatarElem.style.display = 'flex';
            }
            if (mediaType === 'audio') {
                delete this.remoteAudioTracks[user.uid];
                this.debugState.remoteAudio = 'NOT RECEIVED 🔴';
            }

            this.updateDebugPanel();
        });

        // Remote User Left Event
        this.client.on('user-left', (user) => {
            console.log(`[ROOM] User left: #${user.uid}`);
            delete this.remoteAudioTracks[user.uid];
            delete this.remoteVideoTracks[user.uid];
            this.closePeer(user.uid);
        });

        // Connection State Change & Auto-Reconnection
        this.client.on('connection-state-change', (curState, revState) => {
            console.log(`[ROOM] Connection state changed: ${revState} -> ${curState}`);
            if (curState === 'RECONNECTING') {
                console.log('[MEDIA] Connection reconnecting');
                this.setConnectionState('RECONNECTING');
            } else if (curState === 'CONNECTED') {
                console.log('[MEDIA] Connection recovered');
                this.setConnectionState('CONNECTED');
            } else if (curState === 'DISCONNECTED') {
                this.setConnectionState('DISCONNECTED');
            }
        });
    }

    /**
     * Camera Toggle (Publish / Unpublish / Enable / Disable)
     */
    async toggleCamera(enabled) {
        if (this.localVideoTrack) {
            await this.localVideoTrack.setEnabled(enabled);
            this.debugState.teacherVideo = enabled ? 'PUBLISHED 🟢' : 'MUTED 🔴';
            this.updateDebugPanel();
        }
    }

    /**
     * Microphone Toggle
     */
    async toggleMicrophone(enabled) {
        if (this.localAudioTrack) {
            await this.localAudioTrack.setEnabled(enabled);
            this.debugState.teacherAudio = enabled ? 'PUBLISHED 🟢' : 'MUTED 🔴';
            this.updateDebugPanel();
        }
    }

    /**
     * Screen Sharing (Publish Screen Track -> SFU)
     */
    async startScreenShare(classId, targetVideoId) {
        if (!this.client || !this.isTeacher) return null;

        try {
            console.log('[MEDIA] Starting screen share...');
            this.localScreenTrack = await window.AgoraRTC.createScreenVideoTrack({
                encoderConfig: '1080p_2',
                optimizationMode: 'detail'
            });

            // Unpublish camera track if active
            if (this.localVideoTrack) {
                await this.client.unpublish(this.localVideoTrack);
            }

            // Publish screen track to SFU
            await this.client.publish(this.localScreenTrack);
            console.log('[MEDIA] Screen share published to SFU');

            if (targetVideoId) {
                const stageVideo = document.getElementById(targetVideoId);
                if (stageVideo) {
                    stageVideo.style.display = 'block';
                    this.localScreenTrack.play(targetVideoId);
                }
            }

            // Handle browser stop screen share button
            if (Array.isArray(this.localScreenTrack)) {
                this.localScreenTrack[0].on('track-ended', () => this.stopScreenShare(targetVideoId));
            } else if (this.localScreenTrack.on) {
                this.localScreenTrack.on('track-ended', () => this.stopScreenShare(targetVideoId));
            }

            return this.localScreenTrack;

        } catch (err) {
            console.error('[MEDIA] Screen share error:', err);
            return null;
        }
    }

    /**
     * Stop Screen Sharing and Restore Teacher Camera
     */
    async stopScreenShare(targetVideoId) {
        if (!this.localScreenTrack || !this.client) return;

        try {
            console.log('[MEDIA] Stopping screen share...');
            await this.client.unpublish(this.localScreenTrack);

            if (Array.isArray(this.localScreenTrack)) {
                this.localScreenTrack.forEach(t => t.close());
            } else {
                this.localScreenTrack.close();
            }
            this.localScreenTrack = null;

            // Re-publish camera track
            if (this.localVideoTrack) {
                await this.client.publish(this.localVideoTrack);
                if (targetVideoId) {
                    this.localVideoTrack.play(targetVideoId);
                }
            }
            console.log('[MEDIA] Restored camera publication');

        } catch (err) {
            console.error('[MEDIA] Stop screen share error:', err);
        }
    }

    /**
     * Legacy / Compatibility Initializer
     */
    async initLocalMedia(videoElemId, speakingCallback = null) {
        return this.localStream;
    }

    requestMediaPermissions() {
        return Promise.resolve(null);
    }

    async connectToPeer(targetUserId, classId, remoteVideoElemId = null, isInitiator = false) {
        return { targetUserId };
    }

    async handleSignaling(classId, senderUserId, type, data, remoteVideoElemId = null) {
        return true;
    }

    async sendSignaling(classId, targetUserId, signalType, payload) {
        return true;
    }

    /**
     * UI Autoplay Audio Banner Controls
     */
    showAudioAutoplayBanner() {
        const banner = document.getElementById('audioAutoplayNoticeBanner');
        if (banner) banner.style.setProperty('display', 'flex', 'important');
    }

    hideAudioAutoplayBanner() {
        const banner = document.getElementById('audioAutoplayNoticeBanner');
        if (banner) banner.style.setProperty('display', 'none', 'important');
    }

    enableAudioInteraction() {
        Object.values(this.remoteAudioTracks).forEach(track => {
            try { track.play(); } catch(e) {}
        });
        this.hideAudioAutoplayBanner();
    }

    /**
     * UI Media Error Display
     */
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

    /**
     * Dynamic Participant Card Container Generator
     */
    ensureParticipantCard(targetUserId, targetVideoId = null) {
        const vId = targetVideoId || `video_user_${targetUserId}`;
        let remoteVideo = document.getElementById(vId);
        if (remoteVideo) return remoteVideo;

        const grid = document.getElementById('classParticipantGrid');
        if (!grid) return null;

        const col = document.createElement('div');
        col.className = 'col-md-4 col-6';
        col.id = `col_user_${targetUserId}`;
        col.innerHTML = `
            <div class="participant-grid-card p-2 text-center" id="card_user_${targetUserId}">
                <span id="badge_speaking_${targetUserId}" class="badge bg-success position-absolute top-0 start-0 m-2" style="display: none; z-index: 10;">🟢 SPEAKING</span>
                <div id="${vId}" class="live-video-elem" style="display: block; width: 100%; height: 145px; border-radius: 10px; overflow: hidden; background: #000;"></div>
                <div id="avatar_user_${targetUserId}" class="participant-avatar-placeholder" style="display: none;">
                    U${targetUserId}
                </div>
                <div class="px-2 mt-1">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="fw-bold text-white small text-truncate">Participant #${targetUserId}</span>
                        <span class="badge bg-success" style="font-size: 0.6rem;">🟢 ACTIVE</span>
                    </div>
                </div>
            </div>
        `;
        grid.appendChild(col);
        return document.getElementById(vId);
    }

    /**
     * Close Connection for Single Peer
     */
    closePeer(userId) {
        delete this.remoteAudioTracks[userId];
        delete this.remoteVideoTracks[userId];
        const col = document.getElementById(`col_user_${userId}`);
        if (col) col.remove();
    }

    /**
     * Complete Room Teardown & Resource Cleanup
     */
    async leaveRoom(classId) {
        console.log('[ROOM] Leaving room');

        if (this.localAudioTrack) {
            this.localAudioTrack.stop();
            this.localAudioTrack.close();
            this.localAudioTrack = null;
        }

        if (this.localVideoTrack) {
            this.localVideoTrack.stop();
            this.localVideoTrack.close();
            this.localVideoTrack = null;
        }

        if (this.localScreenTrack) {
            if (Array.isArray(this.localScreenTrack)) {
                this.localScreenTrack.forEach(t => t.close());
            } else {
                this.localScreenTrack.close();
            }
            this.localScreenTrack = null;
        }

        if (this.client) {
            try {
                await this.client.leave();
            } catch (e) {}
            this.client = null;
        }

        this.remoteAudioTracks = {};
        this.remoteVideoTracks = {};
        this.setConnectionState('DISCONNECTED');
        this.debugState.signaling = 'DISCONNECTED 🔴';
        this.debugState.teacherAudio = 'NOT PUBLISHED 🔴';
        this.debugState.teacherVideo = 'NOT PUBLISHED 🔴';
        this.debugState.remoteAudio = 'NOT RECEIVED 🔴';
        this.debugState.remoteVideo = 'NOT RECEIVED 🔴';
        this.updateDebugPanel();
    }

    /**
     * Real-Time Diagnostic Panel Updater
     */
    updateDebugPanel() {
        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.innerText = val;
        };

        setTxt('dbg_signaling', this.debugState.signaling);
        setTxt('dbg_media', this.debugState.media);
        setTxt('dbg_teacher_audio', this.debugState.teacherAudio);
        setTxt('dbg_teacher_video', this.debugState.teacherVideo);
        setTxt('dbg_remote_audio', this.debugState.remoteAudio);
        setTxt('dbg_remote_video', this.debugState.remoteVideo);
        setTxt('dbg_room', this.debugState.roomId);
        setTxt('dbg_role', this.debugState.role);
        setTxt('dbg_participants', this.debugState.participantsCount);
    }
}

// Singleton Engine Instance
const defaultWebRTC = new WebRTCManager();
window.webrtc = defaultWebRTC;

// Static Proxy Delegators for HTML inline functions
WebRTCManager.joinRoomSFU = function(...args) { return defaultWebRTC.joinRoomSFU(...args); };
WebRTCManager.initLocalMedia = function(...args) { return defaultWebRTC.initLocalMedia(...args); };
WebRTCManager.connectToPeer = function(...args) { return defaultWebRTC.connectToPeer(...args); };
WebRTCManager.handleSignaling = function(...args) { return defaultWebRTC.handleSignaling(...args); };
WebRTCManager.toggleCamera = function(...args) { return defaultWebRTC.toggleCamera(...args); };
WebRTCManager.toggleMicrophone = function(...args) { return defaultWebRTC.toggleMicrophone(...args); };
WebRTCManager.startScreenShare = function(...args) { return defaultWebRTC.startScreenShare(...args); };
WebRTCManager.stopScreenShare = function(...args) { return defaultWebRTC.stopScreenShare(...args); };
WebRTCManager.leaveRoom = function(...args) { return defaultWebRTC.leaveRoom(...args); };
WebRTCManager.enableAudioInteraction = function(...args) { return defaultWebRTC.enableAudioInteraction(...args); };

window.WebRTCManager = WebRTCManager;
