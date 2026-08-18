/* Mandatory Camera & Screen Sharing Proctoring Engine */

document.addEventListener('DOMContentLoaded', () => {
    const examData = window.EXAM_CONFIG || {};
    if (!examData.attemptId) return;

    let cameraStream = null;
    let screenStream = null;
    let cameraActive = false;
    let screenActive = false;

    let tabSwitchCount = examData.initialTabSwitches || 0;
    let timerInterval = null;
    let secondsLeft = (examData.durationMinutes || 30) * 60;
    let currentQuestionIndex = 0;
    const userAnswers = {};

    // Elements
    const proctorModalEl = document.getElementById('mandatoryProctorModal');
    const bsProctorModal = proctorModalEl ? new bootstrap.Modal(proctorModalEl) : null;
    
    const btnEnableCamera = document.getElementById('btnEnableCamera');
    const btnEnableScreen = document.getElementById('btnEnableScreen');
    const btnStartExamNow = document.getElementById('btnStartExamNow');
    const modalCameraStatus = document.getElementById('modalCameraStatus');
    const modalScreenStatus = document.getElementById('modalScreenStatus');

    const cameraVideo = document.getElementById('cameraFeed');
    const screenVideo = document.getElementById('screenFeed');
    const cameraStatusIndicator = document.getElementById('cameraStatusIndicator');
    const screenStatusIndicator = document.getElementById('screenStatusIndicator');

    const timerDisplay = document.getElementById('examTimerDisplay');
    const tabSwitchBadge = document.getElementById('tabSwitchBadge');
    const questionCards = document.querySelectorAll('.question-card');
    const paletteButtons = document.querySelectorAll('.question-palette-btn');

    // Show Mandatory Hardware Verification Modal on Load
    if (bsProctorModal) {
        bsProctorModal.show();
    }

    // 1. Mandatory Camera Permission Request
    btnEnableCamera?.addEventListener('click', async () => {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            if (cameraVideo) cameraVideo.srcObject = cameraStream;
            cameraActive = true;

            modalCameraStatus.innerHTML = '<span class="badge bg-success"><i class="fa-solid fa-circle-check me-1"></i> Camera Verified</span>';
            btnEnableCamera.className = 'btn btn-sm btn-success w-100 fw-bold';
            btnEnableCamera.innerHTML = '<i class="fa-solid fa-check"></i> Camera Active';
            btnEnableCamera.disabled = true;

            if (cameraStatusIndicator) {
                cameraStatusIndicator.innerHTML = '<span class="badge bg-success"><i class="fa-solid fa-camera"></i> Active</span>';
            }

            btnEnableScreen.disabled = false;
            checkHardwareReady();
            logProctoringEvent('camera_started', 'Mandatory camera access granted.');
        } catch (err) {
            console.error('Camera access error:', err);
            modalCameraStatus.innerHTML = '<span class="badge bg-danger"><i class="fa-solid fa-circle-xmark me-1"></i> Access Denied</span>';
            logProctoringEvent('camera_denied', 'Student denied mandatory camera access.');
            alert('Mandatory Requirement: You must grant camera access to take this examination.');
        }
    });

    // 2. Mandatory Screen Sharing Permission Request
    btnEnableScreen?.addEventListener('click', async () => {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: "monitor" }
            });
            if (screenVideo) screenVideo.srcObject = screenStream;
            screenActive = true;

            modalScreenStatus.innerHTML = '<span class="badge bg-success"><i class="fa-solid fa-circle-check me-1"></i> Screen Verified</span>';
            btnEnableScreen.className = 'btn btn-sm btn-success w-100 fw-bold';
            btnEnableScreen.innerHTML = '<i class="fa-solid fa-check"></i> Screen Active';
            btnEnableScreen.disabled = true;

            if (screenStatusIndicator) {
                screenStatusIndicator.innerHTML = '<span class="badge bg-success"><i class="fa-solid fa-desktop"></i> Active</span>';
            }

            // Monitor if student stops screen share stream during active exam
            const screenTrack = screenStream.getVideoTracks()[0];
            if (screenTrack) {
                screenTrack.onended = () => {
                    screenActive = false;
                    tabSwitchCount += 2; // Extra violation weight for stopping screen share
                    logProctoringEvent('screen_share_stopped', 'Student stopped sharing screen during active exam!');
                    
                    if (window.showToast) {
                        window.showToast('🚨 MANDATORY SCREEN SHARE STOPPED! Re-enable screen share immediately.', 'danger');
                    }
                    
                    // Lock exam and force re-verification
                    btnEnableScreen.disabled = false;
                    btnEnableScreen.className = 'btn btn-sm btn-outline-danger w-100 fw-bold';
                    btnEnableScreen.innerHTML = 'RE-ENABLE SCREEN SHARE 💻';
                    modalScreenStatus.innerHTML = '<span class="badge bg-danger">Disconnected</span>';
                    
                    if (bsProctorModal) bsProctorModal.show();
                };
            }

            checkHardwareReady();
            logProctoringEvent('screen_share_started', 'Mandatory screen sharing active.');
        } catch (err) {
            console.error('Screen sharing error:', err);
            modalScreenStatus.innerHTML = '<span class="badge bg-danger"><i class="fa-solid fa-circle-xmark me-1"></i> Access Denied</span>';
            logProctoringEvent('screen_share_denied', 'Student denied mandatory screen sharing.');
            alert('Mandatory Requirement: Screen sharing is required to proceed with the examination.');
        }
    });

    function checkHardwareReady() {
        if (cameraActive && screenActive) {
            btnStartExamNow.disabled = false;
            btnStartExamNow.className = 'btn btn-success w-100 py-3 fw-bold fs-6';
        }
    }

    btnStartExamNow?.addEventListener('click', () => {
        if (!cameraActive || !screenActive) {
            alert('Both Camera and Screen Sharing are mandatory!');
            return;
        }
        if (bsProctorModal) bsProctorModal.hide();
        startTimer();
        showQuestion(0);
    });

    // 3. Tab-Switch Monitoring (Page Visibility API)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            tabSwitchCount++;
            if (tabSwitchBadge) {
                tabSwitchBadge.innerText = `Tab Switches: ${tabSwitchCount}`;
                tabSwitchBadge.className = tabSwitchCount >= 3 ? 'badge bg-danger ms-2' : 'badge bg-warning text-dark ms-2';
            }

            if (window.showToast) {
                window.showToast(`⚠️ WARNING: Exam window focus lost! (Violation #${tabSwitchCount})`, 'danger');
            }

            logProctoringEvent('tab_switch', `Student switched tab/window. Total violations: ${tabSwitchCount}`);
        }
    });

    // Send monitoring payload to Flask API
    function logProctoringEvent(eventType, details) {
        fetch('/api/monitoring/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                attempt_id: examData.attemptId,
                event_type: eventType,
                details: details
            })
        }).catch(err => console.error('Failed to log proctoring event:', err));
    }

    // 4. Exam Timer Countdown & Auto-Submit
    function startTimer() {
        if (timerInterval) return;
        timerInterval = setInterval(() => {
            if (secondsLeft <= 0) {
                clearInterval(timerInterval);
                if (window.showToast) window.showToast('Time has expired! Automatically submitting your examination...', 'danger');
                submitExam(true);
            } else {
                secondsLeft--;
                const mins = Math.floor(secondsLeft / 60);
                const secs = secondsLeft % 60;
                if (timerDisplay) {
                    timerDisplay.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                }
            }
        }, 1000);
    }

    // 5. Question Palette Navigation
    window.showQuestion = function(index) {
        if (index < 0 || index >= questionCards.length) return;
        
        questionCards.forEach((card, idx) => {
            card.style.display = idx === index ? 'block' : 'none';
        });

        currentQuestionIndex = index;
        updatePaletteUI();
    };

    function updatePaletteUI() {
        paletteButtons.forEach((btn, idx) => {
            const qId = btn.getAttribute('data-q-id');
            const isAnswered = !!userAnswers[qId];

            btn.classList.remove('current', 'answered');
            if (idx === currentQuestionIndex) {
                btn.classList.add('current');
            } else if (isAnswered) {
                btn.classList.add('answered');
            }
        });
    }

    // Track radio option selection
    document.querySelectorAll('.option-radio').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const qId = e.target.getAttribute('name').replace('q_', '');
            userAnswers[qId] = e.target.value;
            updatePaletteUI();
        });
    });

    // 6. Submit Exam Function
    window.submitExam = async function(isAutoSubmit = false) {
        if (!isAutoSubmit) {
            const confirmSubmit = confirm('Are you sure you want to submit your examination now?');
            if (!confirmSubmit) return;
        }

        clearInterval(timerInterval);
        
        // Stop media streams on submission
        if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
        if (screenStream) screenStream.getTracks().forEach(track => track.stop());

        try {
            const response = await fetch(`/api/exam/submit/${examData.attemptId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answers: userAnswers })
            });

            const result = await response.json();
            if (result.success && result.redirect_url) {
                window.location.href = result.redirect_url;
            } else {
                alert('Submission failed. Please contact your instructor.');
            }
        } catch (err) {
            console.error('Submission error:', err);
            alert('Network error during submission. Retrying...');
        }
    };
});
