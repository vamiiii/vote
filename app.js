// ======================= API КЛИЕНТ =======================
const API_BASE_URL = 'https://af0af0ce7f6a28.lhr.life';

const api = {
    async get(endpoint) {
        const response = await fetch(`${API_BASE_URL}${endpoint}`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `API Error: ${response.status}`);
        }
        return await response.json();
    },
    
    async post(endpoint, data) {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `API Error: ${response.status}`);
        }
        return await response.json();
    },
    
    async delete(endpoint) {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `API Error: ${response.status}`);
        }
        return await response.json();
    }
};

// ======================= ГЛОБАЛЬНЫЕ ДАННЫЕ =======================
let candidates = [];
let districts = [];
let incidents = [];
let voters = [];
let ballots = [];
let elections = [];
let scanner = null;
let chartInstance = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

// ======================= ЗАГРУЗКА ДАННЫХ =======================
async function loadAllData() {
    try {
        const [cands, dists, incs, votersData, ballotsData, elecs] = await Promise.all([
            api.get('/candidates'),
            api.get('/districts'),
            api.get('/incidents'),
            api.get('/voters'),
            api.get('/ballots'),
            api.get('/elections')
        ]);
        
        candidates = cands.candidates || [];
        districts = dists.districts || [];
        incidents = incs.incidents || [];
        voters = votersData.voters || [];
        ballots = ballotsData.ballots || [];
        elections = elecs.elections || [];
        
        renderAll();
        return true;
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        showToast('❌ Ошибка подключения к серверу', 'error');
        return false;
    }
}

// ======================= TOAST =======================
function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<div>${msg}</div>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ======================= МОДАЛЬНЫЕ ОКНА =======================
function openModal(id) { 
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
}
function closeModal(id) { 
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}
function openQuickAddModal() { openModal('quick-add-modal'); }
function openManualEntryModal() { 
    fillManualForm();
    openModal('manual-entry-modal'); 
}
function openElectionFormModal() { 
    document.getElementById('election-name').value = '';
    document.getElementById('election-type').value = 'regional';
    openModal('election-form-modal'); 
}

function openDistrictFormModal() {
    let modal = document.getElementById('district-form-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'district-form-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Создать УИК</h3>
                    <button class="modal-close" onclick="closeModal('district-form-modal')">&times;</button>
                </div>
                <div class="form-grid">
                    <div class="form-group">
                        <label>Номер УИК</label>
                        <input type="number" id="new-district-number" class="form-control" placeholder="Например: 106">
                    </div>
                    <div class="form-group">
                        <label>Название учреждения</label>
                        <input type="text" id="new-district-name" class="form-control" placeholder="Школа №2">
                    </div>
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label>Адрес</label>
                        <input type="text" id="new-district-address" class="form-control" placeholder="ул. Пушкина, д. 10">
                    </div>
                    <div class="form-group">
                        <label>Количество избирателей (вместимость)</label>
                        <input type="number" id="new-district-capacity" class="form-control" value="2000">
                    </div>
                </div>
                <button class="btn btn-primary" onclick="submitDistrictForm()" style="width: 100%; margin-top: 20px;">
                    <i class="fas fa-save"></i> Сохранить
                </button>
            </div>
        `;
        document.body.appendChild(modal);
    }
    openModal('district-form-modal');
}

async function submitDistrictForm() {
    const num = document.getElementById('new-district-number').value;
    const name = document.getElementById('new-district-name').value;
    const address = document.getElementById('new-district-address').value;
    const cap = document.getElementById('new-district-capacity').value;
    
    if (!num || !name) {
        showToast("Заполните номер и название!", "error");
        return;
    }
    
    try {
        await api.post('/add-district', {
            districtNumber: parseInt(num),
            name: `УИК №${num} (${name})`,
            address: address,
            capacity: parseInt(cap) || 0
        });
        showToast("✅ Участок создан", "success");
        closeModal('district-form-modal');
        loadAllData();
    } catch(e) {
        showToast("❌ " + e.message, "error");
    }
}

function openVoterFormModal() {
    let modal = document.getElementById('voter-form-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'voter-form-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Добавить избирателя</h3>
                    <button class="modal-close" onclick="closeModal('voter-form-modal')">&times;</button>
                </div>
                <div class="form-grid">
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label>Участок (УИК)</label>
                        <select id="new-voter-district" class="form-control"></select>
                    </div>
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label>Паспорт (Серия и Номер)</label>
                        <input type="text" id="new-voter-passport" class="form-control" placeholder="1234 567890">
                    </div>
                    <div class="form-group">
                        <label>Имя</label>
                        <input type="text" id="new-voter-firstname" class="form-control" placeholder="Иван">
                    </div>
                    <div class="form-group">
                        <label>Фамилия</label>
                        <input type="text" id="new-voter-lastname" class="form-control" placeholder="Иванов">
                    </div>
                </div>
                <button class="btn btn-primary" onclick="submitVoterForm()" style="width: 100%; margin-top: 20px;">
                    <i class="fas fa-user-plus"></i> Добавить
                </button>
            </div>
        `;
        document.body.appendChild(modal);
    }
    const select = document.getElementById('new-voter-district');
    select.innerHTML = districts.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    
    openModal('voter-form-modal');
}

async function submitVoterForm() {
    const passport = document.getElementById('new-voter-passport').value;
    const distId = document.getElementById('new-voter-district').value;
    const fname = document.getElementById('new-voter-firstname').value;
    const lname = document.getElementById('new-voter-lastname').value;
    
    if (!passport || !fname || !lname) {
        showToast("Заполните все поля!", "error");
        return;
    }
    
    try {
        await api.post('/add-voter', {
            passport: passport,
            districtId: parseInt(distId),
            firstName: fname,
            lastName: lname
        });
        showToast("✅ Избиратель добавлен", "success");
        closeModal('voter-form-modal');
        loadAllData();
    } catch(e) {
        showToast("❌ " + e.message, "error");
    }
}

// ======================= РЕНДЕР ВСЕХ ДАННЫХ =======================
function renderAll() {
    renderDashboard();
    renderCandidates();
    renderDistricts();
    renderVoters();
    renderIncidents();
    renderCalendar();
    renderForms();
    renderVotesLog();
    renderScannerLog();
    renderAnalytics();
}

// ======================= ДАШБОРД =======================
function renderDashboard() {
    const totalVotes = candidates.reduce((a, c) => a + (c.votes || 0), 0);
    const totalVoters = districts.reduce((a, d) => a + (d.voterCapacity || 0), 0);
    const turnout = totalVoters ? ((totalVotes / totalVoters) * 100).toFixed(1) : 0;

    document.getElementById('dash-total-votes').textContent = totalVotes.toLocaleString();
    document.getElementById('dash-turnout').textContent = turnout + '%';
    document.getElementById('turnout-fill').style.width = turnout + '%';

    const active = districts.filter(d => d.voted > 0).length;
    const total = districts.length || 1;
    document.getElementById('dash-districts-done').textContent = `${active}/${total}`;
    document.getElementById('dash-progress').style.width = `${(active / total) * 100}%`;

    const errors = incidents.filter(i => !i.isResolved).length;
    document.getElementById('dash-active-errors').textContent = errors;
    document.getElementById('scanner-status-text').textContent = errors > 0 ? 'Есть ошибки!' : 'Система стабильна';

    const ctx = document.getElementById('mainChart');
    if (ctx) {
        if (chartInstance) chartInstance.destroy();
        const sorted = [...candidates].sort((a, b) => (b.votes || 0) - (a.votes || 0));
        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sorted.map(c => c.fullName || c.name),
                datasets: [{
                    data: sorted.map(c => c.votes || 0),
                    backgroundColor: sorted.map(c => c.colorHex || '#4f46e5')
                }]
            },
            options: { 
                plugins: { legend: { display: false } }, 
                responsive: true,
                maintainAspectRatio: false
            }
        });
    }

    const mapGrid = document.getElementById('district-map');
    if (mapGrid) {
        mapGrid.innerHTML = districts.map(d => `
            <div class="map-cell ${d.voted > 0 ? 'active' : 'empty'}" onclick="showDistrictStats(${d.id})">
                <div>${d.districtNumber || d.id}</div>
                <div style="font-size: 9px;">${d.voted || 0}</div>
            </div>
        `).join('');
    }
}

// ======================= КАНДИДАТЫ =======================
function renderCandidates() {
    const tbody = document.getElementById('candidates-body');
    if (!tbody) return;
    const total = candidates.reduce((a, c) => a + (c.votes || 0), 0) || 1;
    
    tbody.innerHTML = candidates.map(c => `
        <tr>
            <td>${c.id}</td>
            <td><span style="color:${c.colorHex || '#4f46e5'}">●</span> ${c.fullName || c.name}</td>
            <td>${c.party || ''}</td>
            <td>${c.votes || 0}</td>
            <td>${((c.votes || 0) / total * 100).toFixed(1)}%</td>
            <td><button class="btn btn-danger btn-sm" onclick="deleteCandidate(${c.id})"><i class="fas fa-trash"></i></button></td>
        </tr>
    `).join('');
}

function openCandidateFormModal() {
    const fullName = prompt("Введите ФИО кандидата:");
    if (!fullName) return;
    const party = prompt("Введите партию:") || '';
    const color = prompt("Введите цвет (HEX, например #4f46e5):", "#" + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'));
    
    api.post('/add-candidate', { fullName, party, colorHex: color })
        .then(() => {
            showToast('✅ Кандидат добавлен', 'success');
            loadAllData();
        })
        .catch(err => showToast('❌ ' + err.message, 'error'));
}

async function deleteCandidate(id) {
    if (!confirm("Удалить кандидата?")) return;
    try {
        await api.delete(`/delete-candidate/${id}`);
        showToast('✅ Кандидат удален', 'success');
        loadAllData();
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    }
}

// ======================= УЧАСТКИ =======================
function renderDistricts() {
    const tbody = document.getElementById('districts-body');
    if (!tbody) return;
    
    tbody.innerHTML = districts.map(d => {
        const totalBallots = Math.floor(d.voterCapacity * 1.05);
        
        // ИСПРАВЛЕНИЕ: Теперь "Выдано" считается по счетчику выдач избирателям
        const districtVoters = voters.filter(v => v.districtId === d.id);
        const issued = districtVoters.reduce((sum, v) => sum + (v.issueCount || 0), 0);
        
        const spoiled = ballots.filter(b => b.districtId === d.id && !b.isValid).length;
        const remaining = totalBallots - issued;
        
        return `<tr>
            <td>${d.districtNumber || d.id}</td>
            <td>
                <div style="font-weight: 600;">${d.name}</div>
                <div style="font-size: 12px; color: var(--text-light);">${d.address || ''}</div>
            </td>
            <td>${d.chairman || 'Не назначен'}</td>
            <td style="font-size: 12px;">
                <div>Всего: ${totalBallots}</div>
                <div style="color: var(--primary);">Выдано: ${issued}</div>
                <div style="color: var(--danger);">Испорчено: ${spoiled}</div>
                <div style="color: var(--secondary);">Остаток: ${remaining}</div>
            </td>
            <td>
                <div style="font-size: 16px; font-weight: bold;">${d.voted || 0}</div>
                <div style="font-size: 11px; color: var(--text-light);">
                    ${d.voterCapacity > 0 ? ((d.voted / d.voterCapacity) * 100).toFixed(1) : 0}%
                </div>
            </td>
            <td>
                <span class="badge ${d.isActive ? 'badge-success' : 'badge-warning'}">
                    ${d.isActive ? 'Открыт' : 'Закрыт'}
                </span>
                <div style="display: flex; gap: 5px; margin-top: 5px;">
                    <button class="btn btn-sm btn-outline" onclick="showDistrictStats(${d.id})" title="Статистика">
                        <i class="fas fa-chart-bar"></i>
                    </button>
                    <button class="btn btn-sm ${d.isActive ? 'btn-danger' : 'btn-success'}" onclick="toggleDistrictStatus(${d.id})" title="Изменить статус">
                        <i class="fas ${d.isActive ? 'fa-lock' : 'fa-lock-open'}"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

async function toggleDistrictStatus(id) {
    try {
        await api.post(`/toggle-district-status/${id}`);
        showToast('Статус участка изменен', 'success');
        loadAllData();
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    }
}

function showDistrictStats(id) {
    const d = districts.find(d => d.id === id);
    if (!d) return;
    
    const totalBallots = Math.floor(d.voterCapacity * 1.05);
    const districtVoters = voters.filter(v => v.districtId === d.id);
    
    // ИСПРАВЛЕНИЕ: Обновленный расчет для всплывающего окна статистики
    const issued = districtVoters.reduce((sum, v) => sum + (v.issueCount || 0), 0);
    
    const spoiled = ballots.filter(b => b.districtId === d.id && !b.isValid).length;
    const remaining = totalBallots - issued;
    const received = districtVoters.filter(v => v.status === 'Выдан').length;
    
    alert(`📊 СТАТИСТИКА УЧАСТКА ${d.districtNumber || d.id}
    
📌 Название: ${d.name}
📍 Адрес: ${d.address || 'Не указан'}
👤 Председатель: ${d.chairman || 'Не назначен'}

📋 ИЗБИРАТЕЛИ:
• Всего по списку: ${d.voterCapacity}
• Получили бланк: ${received}
• Ожидают: ${districtVoters.length - received}

📄 БЛАНКИ:
• Всего получено: ${totalBallots}
• Выдано избирателям: ${issued}
• Испорчено: ${spoiled}
• Остаток: ${remaining}

✅ ПРОГОЛОСОВАЛО: ${d.voted || 0}
📊 ЯВКА: ${d.voterCapacity > 0 ? ((d.voted / d.voterCapacity) * 100).toFixed(1) : 0}%`);
}
// ======================= ИЗБИРАТЕЛИ =======================
function renderVoters() {
    const tbody = document.getElementById('voters-body');
    if (!tbody) return;

    const search = document.getElementById('voter-search')?.value?.toLowerCase() || '';
    const filter = document.getElementById('voter-district-filter')?.value || '';

    const filtered = voters.filter(v => {
        const matchSearch = v.fullName.toLowerCase().includes(search) || v.passport.includes(search);
        const matchFilter = filter ? v.districtId == filter : true;
        return matchSearch && matchFilter;
    });

    tbody.innerHTML = filtered.map(v => {
        const dist = districts.find(d => d.id === v.districtId);
        const distName = dist ? dist.name : 'Неизвестно';
        
        let statusHtml = '';
        let actionsHtml = '';
        
        if (v.status === 'Выдан') {
            statusHtml = `<span class="badge badge-success">✅ Получил</span>`;
            if (v.issueCount > 1) {
                statusHtml += `<div style="font-size: 10px; color: var(--danger);">Повторный (${v.issueCount})</div>`;
            }
            if (v.voteTime) {
                statusHtml += `<div style="font-size: 10px; color: var(--text-light);">${new Date(v.voteTime).toLocaleTimeString('ru-RU')}</div>`;
            }
            actionsHtml = `
                <button class="btn btn-warning btn-sm" onclick="markVoterSpoiled(${v.id})">
                    <i class="fas fa-times"></i> Испорчен
                </button>
            `;
        } else if (v.status === 'Испорчен') {
            statusHtml = `<span class="badge badge-danger">❌ Испорчен</span>`;
            if (v.voteTime) {
                statusHtml += `<div style="font-size: 10px; color: var(--text-light);">${new Date(v.voteTime).toLocaleTimeString('ru-RU')}</div>`;
            }
            actionsHtml = `
                <button class="btn btn-primary btn-sm" onclick="markVoterReceived(${v.id})">
                    <i class="fas fa-redo"></i> Выдать замену
                </button>
            `;
        } else {
            statusHtml = `<span class="badge badge-warning">⏳ Ожидает</span>`;
            actionsHtml = `
                <button class="btn btn-primary btn-sm" onclick="markVoterReceived(${v.id})">
                    <i class="fas fa-file-signature"></i> Выдать бланк
                </button>
            `;
        }

        return `<tr>
            <td style="font-family: monospace;">${v.passport}</td>
            <td style="font-weight: 500;">${v.fullName}</td>
            <td style="font-size: 12px;">${distName}</td>
            <td>${statusHtml}</td>
            <td>${actionsHtml}</td>
        </tr>`;
    }).join('');

    const filterEl = document.getElementById('voter-district-filter');
    if (filterEl && filterEl.options.length <= 1) {
        filterEl.innerHTML = '<option value="">Все участки</option>' + 
            districts.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    }
}

async function markVoterReceived(id) {
    const voter = voters.find(v => v.id === id);
    if (!voter) return;
    const district = districts.find(d => d.id === voter.districtId);
    if (!district) return;
    
    if (!district.isActive) {
        showToast("❌ Выдача невозможна: участок закрыт!", "error");
        return;
    }
    
    const totalBallots = Math.floor(district.voterCapacity * 1.05);
    // ИСПРАВЛЕНИЕ: Проверка лимита по новой формуле
    const districtVoters = voters.filter(v => v.districtId === district.id);
    const issued = districtVoters.reduce((sum, v) => sum + (v.issueCount || 0), 0);
    
    if (issued >= totalBallots) {
        showToast("❌ На участке закончились бланки!", "error");
        return;
    }
    
    try {
        await api.post('/update-voter-status', { id: voter.id, status: 'Выдан' });
        showToast(`✅ Бланк выдан ${voter.fullName}`, "success");
        loadAllData();
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    }
}

async function markVoterSpoiled(id) {
    const voter = voters.find(v => v.id === id);
    if (!voter) return;
    try {
        // Меняем статус человека в Реестре избирателей (без увеличения счетчика)
        await api.post('/update-voter-status', { id: voter.id, status: 'Испорчен' });
        
        // ИСПРАВЛЕНИЕ: Добавляем испорченный бланк в статистику участка
        await api.post('/spoil-ballot', { districtId: voter.districtId });
        
        showToast(`❌ Бланк испорчен для ${voter.fullName}`, "info");
        loadAllData();
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    }
}

// ======================= ИНЦИДЕНТЫ =======================
function renderIncidents() {
    const container = document.getElementById('incident-log-container');
    if (!container) return;

    const active = incidents.filter(i => !i.isResolved);
    
    if (active.length === 0) {
        container.innerHTML = `
            <div style="padding: 30px; background: var(--light); border-radius: 8px; text-align: center; color: var(--text-light); grid-column: 1 / -1;">
                <i class="fas fa-check-double fa-3x" style="margin-bottom: 15px; color: var(--secondary);"></i>
                <p style="font-size: 16px; font-weight: 500;">Нет инцидентов, требующих ручной модерации.</p>
                <p style="font-size: 13px;">Все бланки распознаны корректно.</p>
            </div>
        `;
        return;
    }

    const candidateOptions = candidates.map(c => 
        `<option value="${c.id}">${c.fullName || c.name}</option>`
    ).join('');

    container.innerHTML = active.map(inc => `
        <div class="panel" style="border: 2px solid var(--danger); position: relative; display: flex; flex-direction: column;">
            <div class="badge badge-danger" style="position: absolute; top: 10px; right: 10px; z-index: 10;">
                <i class="fas fa-exclamation-triangle"></i> ${inc.errorCode || 'Ошибка'}
            </div>
            
            <h4 style="margin-bottom: 10px;">Инцидент #${inc.id}</h4>
            <div style="margin-bottom: 15px; font-size: 13px; color: var(--text-light);">
                <div><i class="fas fa-map-marker-alt"></i> Участок ID: ${inc.districtId}</div>
                <div><i class="fas fa-clock"></i> Время: ${inc.detectionTime ? new Date(inc.detectionTime).toLocaleTimeString('ru-RU') : 'Неизвестно'}</div>
            </div>
            
            ${inc.imagePath ? `
                <div style="height: 160px; border-radius: 8px; margin-bottom: 15px; overflow: hidden; border: 1px solid var(--border); background: #000;">
                    <img src="${inc.imagePath}" style="width: 100%; height: 100%; object-fit: contain; cursor: pointer;" onclick="openFullscreenImage('${inc.imagePath}')" title="Нажмите для открытия на весь экран">
                </div>
            ` : `
                <div style="height: 100px; background: var(--light); border-radius: 8px; margin-bottom: 15px; display: flex; align-items: center; justify-content: center; color: var(--text-light);">
                    <i class="fas fa-image fa-2x" style="margin-right: 10px;"></i> Фото отсутствует
                </div>
            `}
            
            <div class="form-group" style="margin-top: auto;">
                <label style="font-size: 12px; font-weight: 600;">Решение модератора (Засчитать как):</label>
                <select id="resolve-cand-${inc.id}" class="form-control" style="margin-bottom: 15px; border-color: var(--primary);">
                    <option value="">-- Выберите кандидата --</option>
                    ${candidateOptions}
                </select>
            </div>

            <div style="display: flex; gap: 10px;">
                <button class="btn btn-success" style="flex: 1; justify-content: center;" onclick="resolveIncident(${inc.id}, true)">
                    <i class="fas fa-check-circle"></i> Засчитать
                </button>
                <button class="btn btn-danger" style="flex: 1; justify-content: center;" onclick="resolveIncident(${inc.id}, false)">
                    <i class="fas fa-times-circle"></i> В брак
                </button>
            </div>
        </div>
    `).join('');
}

async function resolveIncident(id, isValid) {
    const inc = incidents.find(i => i.id === id);
    if (!inc) return;
    
    let candidateId = null;
    if (isValid) {
        const select = document.getElementById(`resolve-cand-${id}`);
        candidateId = parseInt(select?.value);
        if (!candidateId) {
            showToast("Выберите кандидата!", "warning");
            return;
        }
    }
    
    try {
        await api.post(`/resolve-incident/${id}`, {
            verdict: isValid ? 'valid' : 'invalid',
            candidateId: candidateId,
            operatorId: 1
        });
        showToast(isValid ? '✅ Голос засчитан' : '❌ Бюллетень в брак', 'success');
        loadAllData();
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    }
}

// ======================= СКАНЕР =======================
class BallotScanner {
    constructor() {
        this.isScanning = false;
        this.totalScanned = ballots.length;
        this.totalErrors = incidents.filter(i => !i.isResolved).length;
        this.updateUI();
    }

    start() {
        if (this.isScanning) return;
        this.isScanning = true;
        document.getElementById('scanner-status').className = 'badge badge-success';
        document.getElementById('scanner-status').innerHTML = '<i class="fas fa-circle"></i> Сканирование';
        document.getElementById('start-scanner-btn').disabled = true;
        document.getElementById('stop-scanner-btn').disabled = false;
        document.querySelector('.scan-line').style.display = 'block';
        showToast("Сканер запущен", "success");
        this.scanLoop();
    }

    stop() {
        if (!this.isScanning) return;
        this.isScanning = false;
        document.getElementById('scanner-status').className = 'badge badge-warning';
        document.getElementById('scanner-status').innerHTML = '<i class="fas fa-circle"></i> Остановлен';
        document.getElementById('start-scanner-btn').disabled = false;
        document.getElementById('stop-scanner-btn').disabled = true;
        document.querySelector('.scan-line').style.display = 'none';
    }

    async scanLoop() {
        if (!this.isScanning) return;
        await this.scanBallot();
        if (this.isScanning) {
            setTimeout(() => this.scanLoop(), 3000);
        }
    }

    async scanBallot() {
        try {
            const data = await api.get('/scan');

            // Если пришла системная ошибка (в т.ч. из-за того что участок закрыт)
            if (data.status === 'sys_error') {
                showToast(data.message, "error");
                this.stop();
                return;
            }

            const previewImg = document.getElementById('scanned-image-result');
            const previewText = document.getElementById('scanner-preview-text');
            
            if (data.image_base64) {
                if (previewImg) {
                    previewImg.src = data.image_base64;
                    previewImg.style.display = 'block';
                }
                if (previewText) previewText.style.display = 'none';
            }

            if (data.status === 'success') {
                this.totalScanned++;
                showToast(`✅ Голос засчитан! Кандидат ID: ${data.candidate_id}`, "success");
                await loadAllData();
                this.updateUI();
                this.updateLog();
            } else {
                this.totalErrors++;
                showToast(`❌ Ошибка: ${data.errorType}`, "error");
                await loadAllData();
                this.updateUI();
                this.updateLog();
                renderIncidents();
                this.stop();
            }

        } catch (error) {
            console.error("Ошибка API:", error);
            showToast("Нет связи с сервером YOLO", "error");
            this.stop();
        }
    }

    updateUI() {
        document.getElementById('total-scanned').textContent = this.totalScanned;
        document.getElementById('total-errors').textContent = this.totalErrors;
        document.getElementById('scan-speed').textContent = `${Math.round(this.totalScanned / 2)}/мин`;
    }

    // --- ОБНОВЛЕНИЕ ЛОГИКИ ОТОБРАЖЕНИЯ ПРИЧИН БРАКА В ЛОГЕ ---
    updateLog() {
        const tbody = document.getElementById('scanner-log');
        if (!tbody) return;
        
        let combined = [
            // ИСПРАВЛЕНИЕ: Показываем только те бюллетени, которые прошли через сканер
            ...ballots
                .filter(b => b.inputMethod === 'Скан')
                .map(b => ({ type: 'ballot', time: new Date(b.recordTime), data: b })),
            ...incidents.map(i => ({ type: 'incident', time: new Date(i.detectionTime), data: i }))
        ];
        
        combined.sort((a, b) => b.time - a.time);
        const logs = combined.slice(0, 10);
        
        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-light);">Нет записей</td></tr>`;
            return;
        }
        
        tbody.innerHTML = logs.map(item => {
            const timeStr = item.time.toLocaleTimeString('ru-RU');
            if (item.type === 'ballot') {
                const b = item.data;
                const cand = candidates.find(c => c.id === b.candidateId);
                const isInvalid = !b.isValid;
                
                return `<tr>
                    <td>${timeStr}</td>
                    <td>#${b.id}</td>
                    <td><span class="badge ${isInvalid ? 'badge-danger' : 'badge-success'}">${isInvalid ? 'Брак' : 'Успех'}</span></td>
                    <td style="${isInvalid ? 'color: var(--danger);' : ''}">${isInvalid ? 'Отбраковано модератором' : (cand ? cand.fullName : 'Неизвестно')}</td>
                </tr>`;
            } else {
                const inc = item.data;
                const errorNames = {
                    'NO_MARK': 'Пустой бланк',
                    'DOUBLE_MARK': 'Две и более отметок',
                    'DAMAGED': 'Отметка не распознана',
                    'MANUAL_REVIEW': 'Отправлен вручную'
                };
                const reason = errorNames[inc.errorCode] || inc.errorCode;

                return `<tr style="background-color: rgba(239, 68, 68, 0.05);">
                    <td>${timeStr}</td>
                    <td>Инцидент #${inc.id}</td>
                    <td><span class="badge badge-danger">Ошибка</span></td>
                    <td style="color: var(--danger);"><i class="fas fa-exclamation-circle"></i> Причина: ${reason}</td>
                </tr>`;
            }
        }).join('');
    }
    // ---------------------------------------------------------
}

function renderScannerLog() {
    if (scanner) scanner.updateLog();
}

// ======================= КАЛЕНДАРЬ =======================
function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const monthLabel = document.getElementById('current-month');
    if (!grid || !monthLabel) return;

    const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
    monthLabel.textContent = `${monthNames[currentMonth]} ${currentYear}`;

    let html = '';
    const daysOfWeek = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    daysOfWeek.forEach(d => html += `<div class="calendar-day-header">${d}</div>`);

    const date = new Date(currentYear, currentMonth, 1);
    let firstDayIndex = date.getDay() - 1;
    if (firstDayIndex === -1) firstDayIndex = 6;

    for (let i = 0; i < firstDayIndex; i++) {
        html += `<div class="calendar-day" style="opacity: 0.2"></div>`;
    }

    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();

    for (let i = 1; i <= daysInMonth; i++) {
        const isToday = (i === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear());
        let hasElection = false;
        let electionHtml = '';
        
        elections.forEach(e => {
            if (e.startDate) {
                const eDate = new Date(e.startDate);
                if (eDate.getDate() === i && eDate.getMonth() === currentMonth && eDate.getFullYear() === currentYear) {
                    hasElection = true;
                    electionHtml = `<br><i class="fas fa-vote-yea" title="${e.name}"></i>`;
                }
            }
        });
        
        let classes = "calendar-day" + (isToday ? " today" : "") + (hasElection ? " election" : "");
        html += `<div class="${classes}">${i}${electionHtml}</div>`;
    }
    grid.innerHTML = html;

    const upcoming = document.getElementById('upcoming-elections');
    if (upcoming) {
        const now = new Date();
        const future = elections.filter(e => e.startDate && new Date(e.startDate) > now);
        if (future.length === 0) {
            upcoming.innerHTML = '<div style="color: var(--text-light);">Нет предстоящих выборов</div>';
        } else {
            upcoming.innerHTML = future.map(e => `
                <div class="candidate-card" style="border-left-color: var(--primary); margin-bottom: 10px;">
                    <div class="candidate-avatar">📅</div>
                    <div class="candidate-info">
                        <div style="font-weight: 600; font-size: 14px;">${e.name}</div>
                        <div style="font-size: 12px; color: var(--text-light);">
                            ${e.startDate ? new Date(e.startDate).toLocaleDateString('ru-RU') : '-'} - ${e.endDate ? new Date(e.endDate).toLocaleDateString('ru-RU') : '-'}
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }
}

async function saveElection() {
    const name = document.getElementById('election-name').value;
    const type = document.getElementById('election-type').value;
    const startDate = document.getElementById('election-start').value;
    const endDate = document.getElementById('election-end').value;
    
    if (!name || !startDate || !endDate) {
        showToast("Заполните все поля!", "error");
        return;
    }
    
    try {
        await api.post('/add-election', {
            name,
            type,
            description: '',
            startDate: new Date(startDate).toISOString(),
            endDate: new Date(endDate).toISOString(),
            status: new Date(startDate) > new Date() ? 'upcoming' : 'active'
        });
        showToast('✅ Выборы добавлены', 'success');
        closeModal('election-form-modal');
        loadAllData();
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    }
}

// ======================= ФОРМЫ =======================
function renderForms() {
    const dSelect = document.getElementById('vote-district');
    const cSelect = document.getElementById('vote-candidate');
    const manualDist = document.getElementById('manual-district');
    const manualCand = document.getElementById('manual-candidate');
    
    const options = (select, items, valueKey, labelKey) => {
        if (!select) return;
        select.innerHTML = '<option value="">Выберите...</option>' + 
            items.map(item => `<option value="${item[valueKey]}">${item[labelKey]}</option>`).join('');
    };
    
    if (dSelect) options(dSelect, districts, 'id', 'name');
    if (cSelect) options(cSelect, candidates, 'id', 'fullName');
    if (manualDist) options(manualDist, districts, 'id', 'name');
    if (manualCand) options(manualCand, candidates, 'id', 'fullName');
    
    const logDist = document.getElementById('log-filter-district');
    const logCand = document.getElementById('log-filter-candidate');
    
    if (logDist) {
        logDist.innerHTML = '<option value="">Все участки</option>' + 
            districts.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
    }
    if (logCand) {
        logCand.innerHTML = '<option value="">Все (включая брак)</option><option value="invalid">Только испорченные (Брак)</option>' + 
            candidates.map(item => `<option value="${item.id}">${item.fullName}</option>`).join('');
    }
}

function fillManualForm() {
    document.getElementById('manual-ballot-id').value = `B${Date.now().toString().slice(-6)}`;
}

async function submitManualEntry() {
    const ballotId = document.getElementById('manual-ballot-id').value;
    const districtId = parseInt(document.getElementById('manual-district').value);
    const candidateId = parseInt(document.getElementById('manual-candidate').value);
    const status = document.getElementById('manual-status').value;
    
    if (!districtId || !candidateId) {
        showToast("Выберите участок и кандидата!", "error");
        return;
    }
    
    try {
        if (status === 'success') {
            await api.post('/add-vote', { districtId, candidateId, count: 1 });
            showToast('✅ Голос добавлен', 'success');
        } else {
            await api.post('/add-incident', { districtId, errorCode: 'MANUAL_REVIEW' });
            showToast('⚠️ Бланк отправлен в журнал модерации', 'warning');
        }
        closeModal('manual-entry-modal');
        loadAllData();
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    }
}

// ======================= ГОЛОСОВАНИЕ И ПРОТОКОЛЫ =======================
async function addVote() {
    const distId = parseInt(document.getElementById('vote-district').value);
    const candId = parseInt(document.getElementById('vote-candidate').value);
    const count = parseInt(document.getElementById('vote-count').value);
    
    if (!distId || !candId || !count || count < 1) {
        showToast("Заполните все поля!", "error");
        return;
    }
    
    try {
        await api.post('/add-vote', {
            districtId: distId,
            candidateId: candId,
            count: count
        });
        showToast(`✅ Добавлено ${count} голосов`, 'success');
        loadAllData();
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    }
}

function setupVotesLogFilters() {
    const tbody = document.getElementById('votes-log-body');
    if (!tbody) return;
    const table = tbody.closest('table');
    if (!table || document.getElementById('log-filters-container')) return;
    
    const filterHtml = `
        <div id="log-filters-container" style="display: flex; gap: 10px; margin-bottom: 15px; background: var(--light); padding: 10px; border-radius: 8px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 150px;">
                <label style="font-size: 11px; color: var(--text-light); margin-bottom: 3px; display: block;">Участок:</label>
                <select id="log-filter-district" class="form-control" onchange="renderVotesLog()">
                    <option value="">Все участки</option>
                </select>
            </div>
            <div style="flex: 1; min-width: 150px;">
                <label style="font-size: 11px; color: var(--text-light); margin-bottom: 3px; display: block;">Кандидат / Статус:</label>
                <select id="log-filter-candidate" class="form-control" onchange="renderVotesLog()">
                    <option value="">Все (включая брак)</option>
                    <option value="invalid">Только испорченные (Брак)</option>
                </select>
            </div>
            <div style="flex: 1; min-width: 120px;">
                <label style="font-size: 11px; color: var(--text-light); margin-bottom: 3px; display: block;">Дата:</label>
                <input type="date" id="log-filter-date" class="form-control" onchange="renderVotesLog()">
            </div>
            <div style="flex: 1; min-width: 110px;">
                <label style="font-size: 11px; color: var(--text-light); margin-bottom: 3px; display: block;">Время (с):</label>
                <input type="time" id="log-filter-time-start" class="form-control" onchange="renderVotesLog()">
            </div>
            <div style="flex: 1; min-width: 110px;">
                <label style="font-size: 11px; color: var(--text-light); margin-bottom: 3px; display: block;">Время (по):</label>
                <input type="time" id="log-filter-time-end" class="form-control" onchange="renderVotesLog()">
            </div>
            <div style="display: flex; align-items: flex-end;">
                <button class="btn btn-secondary" onclick="resetVotesLogFilters()" title="Сбросить фильтры"><i class="fas fa-times"></i></button>
            </div>
        </div>
    `;
    table.insertAdjacentHTML('beforebegin', filterHtml);
}

function resetVotesLogFilters() {
    document.getElementById('log-filter-district').value = '';
    document.getElementById('log-filter-candidate').value = '';
    document.getElementById('log-filter-date').value = '';
    document.getElementById('log-filter-time-start').value = '';
    document.getElementById('log-filter-time-end').value = '';
    renderVotesLog();
}

function renderVotesLog() {
    const tbody = document.getElementById('votes-log-body');
    if (!tbody) return;
    
    setupVotesLogFilters(); 
    
    const dFilter = document.getElementById('log-filter-district')?.value || '';
    const cFilter = document.getElementById('log-filter-candidate')?.value || '';
    const dateFilter = document.getElementById('log-filter-date')?.value || '';
    const timeStart = document.getElementById('log-filter-time-start')?.value || '';
    const timeEnd = document.getElementById('log-filter-time-end')?.value || '';
    
    let filtered = ballots;
    
    if (dFilter) filtered = filtered.filter(b => b.districtId == dFilter);
    if (cFilter === 'invalid') {
        filtered = filtered.filter(b => !b.isValid);
    } else if (cFilter) {
        filtered = filtered.filter(b => b.candidateId == cFilter && b.isValid);
    }
    
    filtered = filtered.filter(b => {
        if (!b.recordTime) return false;
        const bDateObj = new Date(b.recordTime);
        const bDate = bDateObj.toISOString().split('T')[0];
        const bTime = bDateObj.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'});
        
        if (dateFilter && bDate !== dateFilter) return false;
        if (timeStart && bTime < timeStart) return false;
        if (timeEnd && bTime > timeEnd) return false;
        return true;
    });
    
    const logs = filtered.slice(0, 50);
    
    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-light); padding: 20px;">Записей не найдено</td></tr>`;
        return;
    }
    
    tbody.innerHTML = logs.map(b => {
        const dist = districts.find(d => d.id === b.districtId);
        const isInvalid = !b.isValid;
        return `<tr>
            <td>${b.recordTime ? new Date(b.recordTime).toLocaleString('ru-RU') : '-'}</td>
            <td>${dist ? dist.name : 'Неизвестно'}</td>
            <td style="${isInvalid ? 'color: var(--danger); text-decoration: line-through;' : ''}">${isInvalid ? 'БРАК (Испорчен)' : (b.candidateName || 'Неизвестно')}</td>
            <td>
                <span class="badge ${isInvalid ? 'badge-danger' : 'badge-success'}">
                    ${isInvalid ? 'Испорчен' : '1'}
                </span>
            </td>
        </tr>`;
    }).join('');
}

// ======================= АНАЛИТИКА =======================
async function renderAnalytics() {
    // 1. Базовая статистика
    const totalVotes = candidates.reduce((sum, c) => sum + (c.votes || 0), 0);
    const totalVoters = districts.reduce((sum, d) => sum + (d.voterCapacity || 0), 0);
    const turnout = totalVoters ? ((totalVotes / totalVoters) * 100).toFixed(1) : 0;
    
    document.getElementById('analytics-turnout').textContent = turnout + '%';
    
    const active = districts.filter(d => d.voterCapacity > 0);
    let avgTurnout = 0;
    if (active.length > 0) {
        const sum = active.reduce((s, d) => s + ((d.voted / d.voterCapacity) * 100), 0);
        avgTurnout = (sum / active.length).toFixed(1);
    }
    document.getElementById('avg-turnout').textContent = avgTurnout + '%';
    
    const errors = incidents.filter(i => !i.isResolved).length;
    document.getElementById('anomalies-count').textContent = errors;
    document.getElementById('anomalies-info').textContent = errors > 0 ? `Есть неразрешенные инциденты` : 'Аномалий не обнаружено';
    
    // 2. Таблица аномальных участков
    const anomaliesTable = document.getElementById('anomalous-districts');
    if (anomaliesTable) {
        const sorted = [...districts]
            .filter(d => d.voterCapacity > 0)
            .map(d => ({
                id: d.id,
                name: d.name,
                turnout: d.voterCapacity > 0 ? (d.voted / d.voterCapacity) * 100 : 0,
                voted: d.voted,
                voters: d.voterCapacity
            }))
            .sort((a, b) => a.turnout - b.turnout);
        
        if (sorted.length === 0) {
            anomaliesTable.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-light);">Нет данных</td></tr>`;
        } else {
            anomaliesTable.innerHTML = sorted.map(d => `
                <tr>
                    <td>УИК ${d.id}</td>
                    <td>${d.turnout.toFixed(1)}%</td>
                    <td>${d.voted}/${d.voters}</td>
                </tr>
            `).join('');
        }
    }

    // 3. НОВОЕ: Отрисовка реального графика Закона Бенфорда
    try {
        const benfordData = await api.get('/reports/benford');
        const ctxB = document.getElementById('benford-chart');
        if (ctxB) {
            if (window.benfordChart) window.benfordChart.destroy();
            window.benfordChart = new Chart(ctxB, {
                type: 'bar',
                data: {
                    labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
                    datasets: [
                        { label: 'Идеальное распределение (%)', data: benfordData.expected, backgroundColor: 'rgba(16, 185, 129, 0.5)' },
                        { label: 'Реальные голоса (%)', data: benfordData.observed, backgroundColor: 'rgba(79, 70, 229, 0.8)' }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
            document.getElementById('benford-result').innerHTML = benfordData.isCompliant ? 
                '<span style="color:var(--secondary); font-weight: bold;"><i class="fas fa-check-circle"></i> Распределение соответствует естественной норме. Риск вбросов минимален.</span>' : 
                '<span style="color:var(--danger); font-weight: bold;"><i class="fas fa-exclamation-triangle"></i> ВНИМАНИЕ: Обнаружены статистические аномалии! Рекомендуется ручной пересчет.</span>';
        }
    } catch (e) { console.error("Ошибка загрузки Бенфорда:", e); }
}

// ======================= ОТЧЕТЫ И ИЗОБРАЖЕНИЯ =======================
function openFullscreenImage(src) {
    let modal = document.getElementById('fs-img-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'fs-img-modal';
        modal.style.cssText = 'display:none; position:fixed; z-index:99999; left:0; top:0; width:100vw; height:100vh; background-color:rgba(0,0,0,0.85); align-items:center; justify-content:center; backdrop-filter:blur(3px);';
        modal.innerHTML = `
            <span style="position:absolute; top:20px; right:40px; color:white; font-size:40px; cursor:pointer; font-weight:bold; transition:0.3s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='white'" onclick="document.getElementById('fs-img-modal').style.display='none'">&times;</span>
            <img id="fs-img-tag" style="max-width:90%; max-height:90%; object-fit:contain; border-radius:8px; box-shadow:0 10px 25px rgba(0,0,0,0.5);">
        `;
        modal.addEventListener('click', function(e) {
            if (e.target === this) this.style.display = 'none';
        });
        document.body.appendChild(modal);
    }
    document.getElementById('fs-img-tag').src = src;
    modal.style.display = 'flex';
}

async function generateReport(type) {
    if (type === 'turnout-hourly') {
        document.getElementById('turnout-report').style.display = 'block';
        document.getElementById('anomaly-report').style.display = 'none';
        document.getElementById('report-date').textContent = new Date().toLocaleDateString('ru-RU');
        
        try {
            // Запрашиваем реальные данные с сервера
            const res = await api.get('/reports/hourly');
            const hourly = res.hourly;
            
            let labels = [];
            let data = [];
            let tableHtml = '';
            const total = candidates.reduce((s, c) => s + (c.votes || 0), 0) || 1;
            
            // Строим график с 8 утра до 20 вечера
            for (let i = 8; i <= 20; i++) {
                labels.push(`${i}:00`);
                let count = hourly[i] || 0;
                data.push(count);
                let percent = ((count / total) * 100).toFixed(1);
                
                if (count > 0) {
                    tableHtml += `<tr><td>${i}:00 - ${i+1}:00</td><td>${count}</td><td>${percent}%</td></tr>`;
                }
            }
            
            const ctx = document.getElementById('hourly-turnout-chart');
            if (ctx) {
                if (window.hourlyChart) window.hourlyChart.destroy();
                window.hourlyChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Динамика поступления голосов',
                            data: data,
                            borderColor: '#4f46e5',
                            backgroundColor: 'rgba(79, 70, 229, 0.1)',
                            fill: true,
                            tension: 0.4
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false }
                });
            }
            
            if (!tableHtml) tableHtml = `<tr><td colspan="3" style="text-align:center;">Голосов еще нет</td></tr>`;
            document.getElementById('hourly-turnout-data').innerHTML = tableHtml;
            showToast("Отчет по явке успешно загружен", "success");
            
        } catch(e) {
            showToast("Ошибка генерации отчета: " + e.message, "error");
        }
        
    } else if (type === 'anomaly-detection') {
        document.getElementById('turnout-report').style.display = 'none';
        document.getElementById('anomaly-report').style.display = 'block';
        
        const total = candidates.reduce((s, c) => s + (c.votes || 0), 0);
        const dists = districts.filter(d => d.voterCapacity > 0);
        const avg = dists.reduce((s, d) => s + (d.voted / d.voterCapacity), 0) / (dists.length || 1);
        const stdDev = Math.sqrt(dists.reduce((s, d) => s + Math.pow((d.voted / d.voterCapacity) - avg, 2), 0) / (dists.length || 1));
        
        let html = `<div class="error-details"><strong>Системный анализ завершен</strong></div>`;
        html += `<p>Всего учтено голосов: <b>${total}</b></p>`;
        html += `<p>Средняя явка по округам: <b>${(avg * 100).toFixed(1)}%</b></p>`;
        html += `<p>Допустимое отклонение (σ): <b>${(stdDev * 100).toFixed(2)}%</b></p>`;
        
        const anomalies = dists.filter(d => Math.abs((d.voted / d.voterCapacity) - avg) > 2 * stdDev);
        if (anomalies.length > 0) {
            html += `<div style="color: var(--danger); margin-top: 15px; font-weight: bold;"><i class="fas fa-exclamation-triangle"></i> Найдено ${anomalies.length} участков с критическими отклонениями (Риск вброса):</div>`;
            anomalies.forEach(d => {
                html += `<div style="font-size: 14px; margin-top: 5px;">• УИК ${d.id} (${d.name}): Явка ${((d.voted / d.voterCapacity) * 100).toFixed(1)}% (отклонение ${(((d.voted / d.voterCapacity) - avg) * 100).toFixed(1)}%)</div>`;
            });
        } else {
            html += `<div style="color: var(--secondary); margin-top: 15px; font-weight: bold;"><i class="fas fa-shield-alt"></i> Аномалий явки не обнаружено. Голосование идет в штатном режиме.</div>`;
        }
        
        document.getElementById('anomaly-detection-results').innerHTML = html;
        showToast("Анализ аномалий завершен", "success");
    }
}

async function generateFullReport() {
    showToast("Формирование документа...", "info");
    
    const totalVotes = candidates.reduce((s, c) => s + (c.votes || 0), 0);
    const totalVoters = districts.reduce((s, d) => s + (d.voterCapacity || 0), 0);
    const turnout = totalVoters ? ((totalVotes / totalVoters) * 100).toFixed(1) : 0;
    const errorsCount = incidents.filter(i => !i.isResolved).length;
    const spoiledCount = ballots.filter(b => !b.isValid).length;
    
    // Сортировка от победителя к проигравшему
    const candHtml = [...candidates].sort((a,b)=>b.votes-a.votes).map(c => 
        `<tr>
            <td>${c.fullName}</td>
            <td>${c.party || 'Самовыдвижение'}</td>
            <td>${c.votes}</td>
            <td><strong>${((c.votes/(totalVotes||1))*100).toFixed(1)}%</strong></td>
        </tr>`
    ).join('');
    
    let methodsHtml = '<li>Данные о методах ввода недоступны</li>';
    try {
        const mRes = await api.get('/reports/methods');
        methodsHtml = '';
        const methodIcons = { 'Скан': '🖨️ Авто-Скан (Нейросеть)', 'Ручной': '⌨️ Ручной ввод протокола', 'Модерация': '🛡️ Ручная модерация инцидента' };
        for (let key in mRes.methods) {
            methodsHtml += `<li><b>${methodIcons[key] || key}:</b> ${mRes.methods[key]} голосов</li>`;
        }
    } catch(e){}

    // Открываем печатную форму в новой вкладке
    const reportWindow = window.open('', '_blank');
    reportWindow.document.write(`
        <html>
        <head>
            <title>Официальный Сводный Протокол</title>
            <style>
                body { font-family: 'Times New Roman', serif; padding: 40px; color: #000; max-width: 900px; margin: 0 auto; line-height: 1.5; }
                h1, h2 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
                th, td { border: 1px solid #000; padding: 8px 12px; text-align: left; }
                th { background-color: #f0f0f0; }
                .summary-box { background: #fafafa; border: 1px solid #000; padding: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; }
                .summary-box div { text-align: center; }
                .summary-box div span { display: block; font-size: 20px; font-weight: bold; margin-top: 5px; }
                .signatures { margin-top: 60px; display: flex; justify-content: space-between; }
                .signatures div { border-top: 1px solid #000; width: 40%; text-align: center; padding-top: 10px; }
                .meta { font-size: 12px; color: #555; text-align: right; margin-bottom: 30px; }
            </style>
        </head>
        <body>
            <div class="meta">Документ сгенерирован автоматически АРМ "Выборы" <br> Дата выгрузки: ${new Date().toLocaleString('ru-RU')}</div>
            
            <h1>СВОДНЫЙ ИТОГОВЫЙ ПРОТОКОЛ</h1>
            <h2>Результатов электронного голосования</h2>
            
            <div class="summary-box">
                <div>Внесено в списки избирателей<span>${totalVoters}</span></div>
                <div>Приняло участие (Явка)<span>${turnout}%</span></div>
                <div>Действительных бланков<span>${totalVotes}</span></div>
                <div>Недействительных бланков<span>${spoiledCount}</span></div>
            </div>
            
            <h3>1. Распределение голосов между кандидатами</h3>
            <table>
                <thead>
                    <tr>
                        <th>ФИО Кандидата</th>
                        <th>Субъект выдвижения</th>
                        <th>Число голосов</th>
                        <th>Процент от числа проголосовавших</th>
                    </tr>
                </thead>
                <tbody>${candHtml}</tbody>
            </table>
            
            <h3>2. Техническая сводка системы</h3>
            <p>Источники получения и обработки бюллетеней:</p>
            <ul>${methodsHtml}</ul>
            <p>Открытых инцидентов / ошибок оборудования на момент закрытия протокола: <b>${errorsCount}</b></p>
            
            <div class="signatures">
                <div>Председатель комиссии<br><br>(подпись, ФИО)</div>
                <div>Секретарь комиссии<br><br>(подпись, ФИО)</div>
            </div>
            
            <script>
                // Автоматически вызываем диалог печати
                setTimeout(() => { window.print(); }, 500);
            </script>
        </body>
        </html>
    `);
    reportWindow.document.close();
}

function printReport() { window.print(); }

// ======================= РЕЗЕРВНОЕ КОПИРОВАНИЕ =======================
function exportDataToFile() {
    showToast("Подготовка архива выборов...", "info");
    
    // Собираем все текущие данные в один объект
    const backupData = {
        exportDate: new Date().toISOString(),
        systemVersion: "1.0.0",
        data: {
            elections: elections,
            districts: districts,
            candidates: candidates,
            voters: voters,
            ballots: ballots,
            incidents: incidents
        }
    };
    
    // Преобразуем объект в строку JSON
    const jsonString = JSON.stringify(backupData, null, 2);
    
    // Создаем виртуальный файл в браузере (Blob)
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    // Формируем имя файла с текущей датой
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `VoteSystem_Backup_${dateStr}.json`;
    
    // Создаем невидимую ссылку и эмулируем клик для скачивания
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    
    // Убираем ссылку и освобождаем память
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("✅ Архив успешно сохранен на устройство", "success");
    }, 100);
}

// ======================= НАСТРОЙКИ =======================
async function factoryReset() {
    if (!confirm("Все данные будут удалены! Вы уверены?")) return;
    if (!confirm("Действительно удалить все данные?")) return;
    showToast("Сброс через SQL Server пока не реализован", "warning");
}

async function generateTestData() {
    if (!confirm("Сгенерировать тестовые данные в SQL Server?")) return;
    try {
        const testVoters = [
            { passport: '1111 111111', firstName: 'Алексей', lastName: 'Смирнов' },
            { passport: '2222 222222', firstName: 'Елена', lastName: 'Козлова' },
            { passport: '3333 333333', firstName: 'Дмитрий', lastName: 'Морозов' }
        ];
        for (const v of testVoters) {
            await api.post('/add-voter', { ...v, districtId: 1 });
        }
        for (let i = 0; i < 10; i++) {
            const candId = Math.floor(Math.random() * candidates.length) + 1;
            await api.post('/add-vote', { districtId: 1, candidateId: candId, count: Math.floor(Math.random() * 3) + 1 });
        }
        showToast('✅ Тестовые данные добавлены', 'success');
        closeModal('quick-add-modal');
        loadAllData();
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    }
}

function refreshData() {
    loadAllData();
    showToast("Данные обновлены", "success");
}

// ======================= ИНИЦИАЛИЗАЦИЯ =======================
document.addEventListener('DOMContentLoaded', async () => {
    await loadAllData();
    
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-link, .tab-content').forEach(el => el.classList.remove('active'));
            link.classList.add('active');
            document.getElementById(link.getAttribute('data-tab')).classList.add('active');
            if (link.getAttribute('data-tab') === 'scanner') {
                renderScannerLog();
                renderIncidents();
            }
            if (link.getAttribute('data-tab') === 'analytics') renderAnalytics();
        });
    });

    document.getElementById('theme-btn').addEventListener('click', () => { document.body.classList.toggle('dark-mode'); });
    document.getElementById('current-date').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    scanner = new BallotScanner();
    document.getElementById('start-scanner-btn').addEventListener('click', () => scanner.start());
    document.getElementById('stop-scanner-btn').addEventListener('click', () => scanner.stop());

    document.getElementById('prev-month').addEventListener('click', () => {
        currentMonth--;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        renderCalendar();
    });
    document.getElementById('next-month').addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        renderCalendar();
    });

    showToast("✅ Система загружена. Данные из SQL Server", "success");
});

// ======================= ГЛОБАЛЬНЫЕ ФУНКЦИИ =======================
window.addVote = addVote;
window.saveElection = saveElection;
window.submitManualEntry = submitManualEntry;
window.generateTestData = generateTestData;
window.factoryReset = factoryReset;
window.refreshData = refreshData;
window.openQuickAddModal = openQuickAddModal;
window.openManualEntryModal = openManualEntryModal;
window.openElectionFormModal = openElectionFormModal;
window.openCandidateFormModal = openCandidateFormModal;
window.openModal = openModal;
window.closeModal = closeModal;
window.resolveIncident = resolveIncident;
window.markVoterReceived = markVoterReceived;
window.markVoterSpoiled = markVoterSpoiled;
window.deleteCandidate = deleteCandidate;
window.showDistrictStats = showDistrictStats;
window.generateReport = generateReport;
window.generateFullReport = generateFullReport;
window.printReport = printReport;
window.openFullscreenImage = openFullscreenImage;
window.resetVotesLogFilters = resetVotesLogFilters;
window.openDistrictFormModal = openDistrictFormModal;
window.submitDistrictForm = submitDistrictForm;
window.toggleDistrictStatus = toggleDistrictStatus;
window.openVoterFormModal = openVoterFormModal;
window.submitVoterForm = submitVoterForm;
window.renderVotersTable = renderVoters;
window.exportDataToFile = exportDataToFile;
