import './style.css'

const WS_URL = 'ws://localhost:8080';
let ws;
const pendingPromises = new Map();

// Generate Request ID for WS mapping
const getRqId = () => Math.random().toString(36).slice(2);

// UI Elements
const statusDot = document.querySelector('.status-dot');
const statusText = document.getElementById('connection-status');
const activityLog = document.getElementById('activity-log');

// State
let votingData = {}; // menuId -> count

function initWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'Connected';
    addLog('System connected to Gateway', 'default-log');
    
    // Auto subscribe globally
    subscribeBackground();
    // Auto load menu
    loadMenus();
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.error('Error parsing WS message', e);
    }
  };

  ws.onclose = () => {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Disconnected. Reconnecting...';
    setTimeout(initWebSocket, 3000);
  };
}

function sendReq(action, payload) {
    return new Promise((resolve, reject) => {
        if(!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('WebSocket Offline'));
        const requestId = getRqId();
        pendingPromises.set(requestId, { resolve, reject });
        ws.send(JSON.stringify({ action, payload, requestId }));

        // Timeout handler
        setTimeout(() => {
            if(pendingPromises.has(requestId)) {
                pendingPromises.get(requestId).reject(new Error('Request Timeout'));
                pendingPromises.delete(requestId);
            }
        }, 8000);
    });
}

function handleServerMessage(msg) {
  const { type, eventType, action, payload, message, requestId } = msg;

  if (requestId && pendingPromises.has(requestId)) {
      if (type === 'ERROR') pendingPromises.get(requestId).reject(new Error(message));
      else pendingPromises.get(requestId).resolve(payload);
      pendingPromises.delete(requestId);
  }

  if (type === 'EVENT') {
    switch (eventType) {
      case 'VOTE_RESULT':
      case 'VOTE_UPDATE':
        updateVotingChart(payload);
        const evType = payload.event_type;
        if (evType === 'USER_CHOICE' || evType === 'TALLY' || evType === 'VOTE_UPDATE') {
          const uId = payload.actor_user_id || 'User';
          const mName = payload.actor_menu_name || payload.menu_name || 'Menu';
          addLog(`New Vote: ${uId} voted for ${mName}`, 'vote-log');
        }
        break;
      
      case 'NUTRITION_PROGRESS':
        updateNutritionGauge(payload);
        addLog(`Nutrition Update: ${payload.current_calories}/${payload.calorie_limit} kcal`, 'nutrition-log');
        break;

      case 'ORDER_STATUS':
        addLog(`Order Status [${payload.order_id}]: ${payload.status} - ${payload.message}`, 'order-log');
        updateOrderTracker(payload);
        break;
    }
  }
}

function subscribeBackground() {
    ws.send(JSON.stringify({ action: 'trackOrderStatus', payload: { orderId: 'SYSTEM-MONITOR' } })); 
}

// ==== UI UTILS ====

function addLog(text, className) {
  const defaultLog = activityLog.querySelector('.default-log');
  if (defaultLog) defaultLog.remove();
  const li = document.createElement('li');
  li.className = `log-item ${className}`;
  li.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span>${text}`;
  activityLog.prepend(li);
  if (activityLog.children.length > 50) activityLog.lastChild.remove();
}

const showToast = (msg, isError) => {
    alert(isError ? "Error: " + msg : "Wait: " + msg); // Temporarily using alert, replace with toast library if preferred, we'll log it instead.
}

// ==== VISUALIZERS ====

function updateVotingChart(payload) {
  const id = payload.menu_id;
  if (!id) return;
  const count = payload.vote_count ?? 0;
  const name = payload.menu_name || payload.actor_menu_name || id;
  
  votingData[id] = { count, name };
  renderVotingChart();
}

function renderVotingChart() {
  const chartContainer = document.getElementById('voting-chart');
  chartContainer.innerHTML = '';
  let maxCount = Math.max(...Object.values(votingData).map(i => i.count), 1);
  if (Object.keys(votingData).length === 0) {
    chartContainer.innerHTML = '<p style="color:var(--text-muted);font-size:0.875rem;">Waiting for vote data...</p>';
    return;
  }
  Object.entries(votingData).forEach(([id, data]) => {
    const p = Math.min(100, Math.round((data.count / maxCount) * 100)); 
    const bar = document.createElement('div');
    bar.className = 'vote-bar-container';
    bar.innerHTML = `
      <div class="vote-label"><span>${data.name}</span><span>${data.count} Votes</span></div>
      <div class="vote-bar-bg"><div class="vote-bar-fill" style="width: 0%"></div></div>
    `;
    chartContainer.appendChild(bar);
    requestAnimationFrame(() => bar.querySelector('.vote-bar-fill').style.width = `${p}%`);
  });
}

function updateNutritionGauge(payload) {
  const pct = payload.percentage || 0;
  const gaugeFill = document.getElementById('gauge-fill');
  document.getElementById('nutrition-text').textContent = `${Math.round(pct)}%`;
  gaugeFill.style.strokeDashoffset = 125 - (125 * Math.min(100, pct) / 100);

  const warn = document.getElementById('nutrition-warning');
  if (pct >= 80) {
    gaugeFill.style.stroke = pct >= 100 ? 'var(--danger)' : 'var(--warning)';
    warn.classList.remove('p-hidden');
    warn.textContent = payload.warning_message || 'Approaching limit!';
  } else {
    gaugeFill.style.stroke = 'var(--success)';
    warn.classList.add('p-hidden');
  }
}

function updateOrderTracker(payload) {
    const oId = payload.order_id;
    const status = payload.status; // RECEIVED, PREPARING, READY, DELIVERED
    const msg = payload.message;
    
    if(!oId || oId === 'SYSTEM-MONITOR') return;

    const widget = document.getElementById('widget-order-status');
    widget.classList.remove('p-hidden');
    
    document.getElementById('track-id-display').textContent = `Order: ${oId.substring(0,8)}...`;
    document.getElementById('track-status-badge').textContent = status;
    document.getElementById('track-message').textContent = msg;
    
    const steps = ['RECEIVED', 'PREPARING', 'READY', 'DELIVERED'];
    const currentIndex = steps.indexOf(status);
    
    document.querySelectorAll('.step').forEach((el, index) => {
        el.className = 'step';
        if (index < currentIndex) el.classList.add('completed');
        if (index === currentIndex) el.classList.add('active');
    });
}

// ==== TABS LOGIC ====
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).style.display = 'flex';
    });
});

// ==== ACTION 1: Get Menu ====
async function loadMenus() {
    try {
        const resp = await sendReq('getMenu', {});
        const list = document.getElementById('menu-list');
        const select = document.getElementById('inp-vote-menu');
        
        list.innerHTML = '';
        select.innerHTML = '';

        if (!resp.menus || resp.menus.length === 0) {
            list.innerHTML = 'No menus loaded.';
            return;
        }

        resp.menus.forEach(m => {
            const el = document.createElement('p');
            el.innerHTML = `<b>${m.name}</b> (ID: ${m.id}) - Rp${m.price}`;
            list.appendChild(el);
            
            const opt = document.createElement('option');
            opt.value = m.id; opt.textContent = m.name;
            select.appendChild(opt);
        });
        addLog('Loaded Menus.', 'default-log');
    } catch(e) {
        addLog(`Error loading menus: ${e.message}`, 'error-log');
    }
}
document.getElementById('btn-get-menu').addEventListener('click', loadMenus);

// ==== ACTION 2: Add Menu & Nutrition ====
document.getElementById('form-add-menu').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('inp-menu-name').value;
    const desc = document.getElementById('inp-menu-desc').value;
    const price = document.getElementById('inp-menu-price').value;

    try {
        const menuResp = await sendReq('addMenu', { name, description: desc, price: Number(price) });
        addLog(`Added Menu: ${menuResp.menu_id} -> ${name}`, 'default-log');
        
        // Check if nutrition provided
        const cal = document.getElementById('inp-nut-cal').value;
        if (cal) {
            const req = {
                menu_id: menuResp.menu_id, 
                menu_name: name,
                calories: Number(cal),
                protein: Number(document.getElementById('inp-nut-pro').value || 0),
                carbs: Number(document.getElementById('inp-nut-carb').value || 0),
                fat: Number(document.getElementById('inp-nut-fat').value || 0)
            };
            const nutResp = await sendReq('addNutrition', req);
            addLog(`Nutrition Added for ${menuResp.menu_id}`, 'nutrition-log');
        }
        e.target.reset();
        loadMenus(); // reload menu list
    } catch (err) {
        addLog(`Failed to add: ${err.message}`, 'error-log');
    }
});

// ==== ACTION 3 & 4: Nutritiom ====
document.getElementById('btn-check-nut').addEventListener('click', async () => {
    const p = document.getElementById('inp-check-nut-menu').value;
    if(!p) return;
    try {
        const resp = await sendReq('getNutrition', { menu_id: p });
        alert(`Nutrition [${resp.menu_name}]: ${resp.calories} kcal, Pro: ${resp.protein}g, Fat: ${resp.fat}g, Carbs: ${resp.carbs}g`);
        addLog(`Fetched nutrition for ${p}`, 'nutrition-log');
    }catch(err) { addLog(err.message, 'error-log'); }
});

document.getElementById('btn-daily-sum').addEventListener('click', async () => {
    const user = document.getElementById('inp-sum-user').value;
    let date = new Date().toISOString().split('T')[0];
    try {
        const resp = await sendReq('getDailySummary', { user_id: user, date });
        alert(`Summary for ${user}: ${resp.total_calories || 0} / ${resp.calorie_limit} kcal. Over limit? ${resp.is_over_limit}`);
        addLog(`Fetched details for ${user} on ${date}`, 'nutrition-log');
    }catch(err){ addLog(err.message, 'error-log'); }
});

// ==== ACTION 5 & 6: Orders & Billing ====
document.getElementById('btn-add-item-row').addEventListener('click', () => {
    const p = document.getElementById('order-items-list');
    const d = document.createElement('div'); d.className = "flex-row item-row mt-1";
    d.innerHTML = `
        <input type="text" placeholder="Menu ID" class="inp-order-item" value="menu-2">
        <input type="number" placeholder="Qty" value="1" class="inp-order-qty" style="width: 80px">
        <button type="button" class="btn secondary remove-item-btn">X</button>
    `;
    d.querySelector('.remove-item-btn').addEventListener('click', () => d.remove());
    p.appendChild(d);
});
document.querySelectorAll('.remove-item-btn').forEach(b => b.addEventListener('click', (e) => e.target.parentElement.remove()));

document.getElementById('btn-create-order').addEventListener('click', async () => {
    const items = [...document.querySelectorAll('.item-row')].map(row => ({
        menu_id: row.querySelector('.inp-order-item').value,
        quantity: Number(row.querySelector('.inp-order-qty').value),
        price: 15000 // In actual client it maps to cached menu price, mock here for simplicity as server accepts
    }));
    try {
        const resp = await sendReq('createOrder', {
            user_id: document.getElementById('inp-order-user').value,
            group_id: document.getElementById('inp-order-group').value,
            items
        });
        const oId = resp.order_id;
        document.getElementById('inp-split-order').value = oId;
        document.getElementById('inp-track-order').value = oId;
        addLog(`Order Created: ${oId}`, 'order-log');
    } catch(err) { addLog(`Create Order Failed: ${err.message}`, 'error-log');}
});

document.getElementById('btn-split-bill').addEventListener('click', async () => {
    const oId = document.getElementById('inp-split-order').value;
    const users = document.getElementById('inp-split-users').value.split(',').map(s=>s.trim());
    try {
        const res = await sendReq('splitBill', { order_id: oId, user_ids: users });
        const rb = document.getElementById('split-bill-result');
        rb.style.display = 'block'; rb.className = 'scroll-box alert-box success';
        rb.innerHTML = `<b>Total: Rp${res.total}</b><br>` + res.bills.map(b => `${b.userId}: Rp${b.amount}`).join('<br>');
    } catch(err) {
        addLog(`Split Bill Failed: ${err}`, 'error-log'); 
        const rb = document.getElementById('split-bill-result');
        rb.style.display = 'block'; rb.className = 'scroll-box alert-box danger';
        rb.innerText = err.message;
    }
});

// ==== ACTION 7,8,9,10: Votes & Streams ====
document.getElementById('btn-watch-vote').addEventListener('click', async () => {
    const sessionId = document.getElementById('inp-watch-session').value;
    try {
        await sendReq('watchVoteResult', { session_id: sessionId });
        addLog(`Subscribed to voting session: ${sessionId}`, 'default-log');
        // Clear old chart data on new session watch
        votingData = {};
        renderVotingChart();
    }catch(err){ addLog(`Watch Session Error: ${err.message}`, 'error-log'); }
});

document.getElementById('btn-vote').addEventListener('click', async () => {
    const user = document.getElementById('inp-vote-user').value;
    const session = document.getElementById('inp-vote-session').value;
    const sel = document.getElementById('inp-vote-menu');
    try {
        await sendReq('voteMenu', { user_id: user, session_id: session, menu_id: sel.value });
        addLog(`User ${user} voted for ${sel.options[sel.selectedIndex].text} in ${session}`, 'vote-log');
    }catch(e){ addLog(`Vote Error: ${e.message}`, 'error-log'); }
});

document.getElementById('btn-stream-nut').addEventListener('click', async () => {
    try {
        await sendReq('streamDailyProgress', { user_id: document.getElementById('inp-stream-nut').value });
        addLog(`Hooked to progress stream`, 'default-log');
    }catch(err){}
});

document.getElementById('btn-track-order').addEventListener('click', async () => {
    try {
        await sendReq('trackOrderStatus', { order_id: document.getElementById('inp-track-order').value });
        addLog(`Subscribed to Order Track`, 'order-log');
    }catch(err){}
});

initWebSocket();
