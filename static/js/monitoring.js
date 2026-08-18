/* Teacher Live Monitoring Realtime Script */

document.addEventListener('DOMContentLoaded', () => {
    const monitoringTableBody = document.getElementById('liveMonitoringTableBody');
    if (!monitoringTableBody) return;

    async function fetchLiveProctoringData() {
        try {
            const response = await fetch('/api/monitoring/live-data');
            const data = await response.json();
            const sessions = data.active_sessions || [];

            if (sessions.length === 0) {
                monitoringTableBody.innerHTML = `
                    <tr>
                        <td colspan="7" class="text-center text-muted py-4">
                            <i class="fa-solid fa-user-check fa-2x mb-2 text-primary"></i>
                            <p class="mb-0">No students are currently taking active examinations.</p>
                        </td>
                    </tr>
                `;
                return;
            }

            let rowsHTML = '';
            sessions.forEach(session => {
                const badgeClass = session.warning_level === 'danger' ? 'bg-danger' :
                                   session.warning_level === 'warning' ? 'bg-warning text-dark' : 'bg-success';

                const cameraBadge = session.camera_status === 'active' ?
                    '<span class="badge bg-success me-1"><i class="fa-solid fa-camera"></i> Cam OK</span>' :
                    '<span class="badge bg-danger me-1"><i class="fa-solid fa-video-slash"></i> Cam Off</span>';

                const screenBadge = '<span class="badge bg-primary"><i class="fa-solid fa-desktop"></i> Screen OK</span>';

                rowsHTML += `
                    <tr>
                        <td>
                            <div class="fw-bold text-dark">${session.student_name}</div>
                            <small class="text-muted">Attempt #${session.attempt_id}</small>
                        </td>
                        <td>${session.exam_title}</td>
                        <td>${cameraBadge} ${screenBadge}</td>
                        <td>
                            <span class="badge ${badgeClass}">
                                ${session.tab_switches} Violation(s)
                            </span>
                        </td>
                        <td><i class="fa-regular fa-clock me-1"></i> ${session.time_remaining}</td>
                        <td><span class="badge bg-info text-dark">${session.status}</span></td>
                        <td>
                            <button class="btn btn-sm btn-outline-danger" onclick="alertStudent(${session.attempt_id})">
                                <i class="fa-solid fa-triangle-exclamation me-1"></i> Warn
                            </button>
                        </td>
                    </tr>
                `;
            });

            monitoringTableBody.innerHTML = rowsHTML;
        } catch (err) {
            console.error('Error fetching live proctoring data:', err);
        }
    }

    window.alertStudent = function(attemptId) {
        if (window.showToast) window.showToast(`Warning sent to student attempt #${attemptId}`, 'warning');
    };

    // Poll live proctoring data every 5 seconds
    fetchLiveProctoringData();
    setInterval(fetchLiveProctoringData, 5000);
});
