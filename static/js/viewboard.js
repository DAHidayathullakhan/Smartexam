/* Interactive ViewBoard Whiteboard Engine */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvasBoard');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Canvas sizing setup
    function resizeCanvas() {
        const container = canvas.parentElement;
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = 600;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // State Variables
    let isDrawing = false;
    let currentTool = 'pen'; // 'pen', 'line', 'rectangle', 'circle', 'eraser'
    let strokeColor = '#2563eb';
    let strokeWidth = 3;
    let startX = 0;
    let startY = 0;
    const historyStack = [];

    // Save canvas state for Undo
    function saveState() {
        if (historyStack.length > 25) historyStack.shift();
        historyStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    }
    saveState();

    // Event Listeners for Tools
    document.querySelectorAll('.viewboard-tool').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.viewboard-tool').forEach(b => b.classList.remove('active'));
            const target = e.currentTarget;
            target.classList.add('active');
            currentTool = target.getAttribute('data-tool');
        });
    });

    const colorPicker = document.getElementById('boardColorPicker');
    if (colorPicker) {
        colorPicker.addEventListener('input', (e) => {
            strokeColor = e.target.value;
        });
    }

    const widthRange = document.getElementById('boardWidthRange');
    if (widthRange) {
        widthRange.addEventListener('input', (e) => {
            strokeWidth = e.target.value;
        });
    }

    document.getElementById('btnClearBoard')?.addEventListener('click', () => {
        saveState();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    document.getElementById('btnUndoBoard')?.addEventListener('click', () => {
        if (historyStack.length > 1) {
            historyStack.pop(); // Remove current state
            const previousState = historyStack[historyStack.length - 1];
            ctx.putImageData(previousState, 0, 0);
        }
    });

    document.getElementById('btnExportBoard')?.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `ViewBoard-Lecture-Notes-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    });

    // Drawing Canvas Logic
    function getPointerPos(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    function startDraw(e) {
        isDrawing = true;
        const pos = getPointerPos(e);
        startX = pos.x;
        startY = pos.y;

        ctx.beginPath();
        ctx.moveTo(startX, startY);

        if (currentTool === 'pen' || currentTool === 'eraser') {
            ctx.strokeStyle = currentTool === 'eraser' ? '#ffffff' : strokeColor;
            ctx.lineWidth = strokeWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        }
    }

    function draw(e) {
        if (!isDrawing) return;
        const pos = getPointerPos(e);

        if (currentTool === 'pen' || currentTool === 'eraser') {
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        }
    }

    function stopDraw(e) {
        if (!isDrawing) return;
        isDrawing = false;
        const pos = getPointerPos(e || {});

        if (currentTool === 'line') {
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(pos.x, pos.y);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            ctx.stroke();
        } else if (currentTool === 'rectangle') {
            ctx.beginPath();
            ctx.rect(startX, startY, pos.x - startX, pos.y - startY);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            ctx.stroke();
        } else if (currentTool === 'circle') {
            const radius = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
            ctx.beginPath();
            ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            ctx.stroke();
        }

        saveState();
    }

    // Attach Event Listeners
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseleave', stopDraw);

    canvas.addEventListener('touchstart', startDraw);
    canvas.addEventListener('touchmove', draw);
    canvas.addEventListener('touchend', stopDraw);
});
