/* Global Platform JavaScript Utilities */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Toast Notification Helper
    window.showToast = function (message, type = 'info') {
        let toastContainer = document.getElementById('toastContainer');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toastContainer';
            toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
            toastContainer.style.zIndex = '1100';
            document.body.appendChild(toastContainer);
        }

        const bgClass = type === 'success' ? 'bg-success' :
                        type === 'danger' ? 'bg-danger' :
                        type === 'warning' ? 'bg-warning text-dark' : 'bg-primary';

        const toastId = 'toast-' + Date.now();
        const toastHTML = `
            <div id="${toastId}" class="toast align-items-center text-white ${bgClass} border-0 shadow-lg" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="d-flex">
                    <div class="toast-body font-weight-bold">
                        <i class="fa-solid fa-bell mr-2"></i> ${message}
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            </div>
        `;
        toastContainer.insertAdjacentHTML('beforeend', toastHTML);

        const toastElement = document.getElementById(toastId);
        const bsToast = new bootstrap.Toast(toastElement, { delay: 4000 });
        bsToast.show();
    };

    // 2. Real-time Live Search Filter (Subjects & Notes)
    const searchInputs = document.querySelectorAll('.live-search-input');
    searchInputs.forEach(input => {
        const targetSelector = input.getAttribute('data-search-target');
        if (targetSelector) {
            input.addEventListener('keyup', (e) => {
                const query = e.target.value.toLowerCase();
                const items = document.querySelectorAll(targetSelector);
                let visibleCount = 0;
                items.forEach(item => {
                    const text = item.textContent.toLowerCase();
                    if (text.includes(query)) {
                        item.style.display = '';
                        visibleCount++;
                    } else {
                        item.style.display = 'none';
                    }
                });

                const noResultsMsg = document.getElementById('noResultsMessage');
                if (noResultsMsg) {
                    noResultsMsg.style.display = visibleCount === 0 ? 'block' : 'none';
                }
            });
        }
    });

    // 3. Smooth Counter Animations for Statistics
    const counters = document.querySelectorAll('.stat-number');
    counters.forEach(counter => {
        const target = +counter.getAttribute('data-target') || +counter.innerText.replace(/[^0-9]/g, '');
        if (target > 0) {
            let count = 0;
            const speed = 200;
            const inc = Math.max(1, Math.ceil(target / speed));
            const updateCount = () => {
                count += inc;
                if (count < target) {
                    counter.innerText = count.toLocaleString();
                    setTimeout(updateCount, 15);
                } else {
                    counter.innerText = target.toLocaleString() + (counter.getAttribute('data-suffix') || '');
                }
            };
            updateCount();
        }
    });
});
