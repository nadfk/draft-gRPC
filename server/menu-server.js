const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const packageDef = protoLoader.loadSync('proto/menu.proto');
const proto = grpc.loadPackageDefinition(packageDef).menu;

function pick(req, camel, snake) {
    return req[camel] ?? req[snake];
}

function log(message) {
    console.log(`[menu] ${message}`);
}

//=== IN MEMORY STATE
const menus = [
    { id: 'menu-1', name: 'Nasi Goreng', description: 'Nasi goreng dengan telur dan sayuran', price: 15000 },
    { id: 'menu-2', name: 'Mie Ayam', description: 'Mie ayam dengan kuah kaldu dan potongan ayam', price: 12000 },
    { id: 'menu-3', name: 'Sate Ayam', description: 'Sate ayam bagian dada dengan bumbu kacang', price: 20000 },
    { id: 'menu-4', name: 'Gado-Gado', description: 'Salad sayuran dengan bumbu kacang', price: 18000 }
];

const voteSessions = {};

function getNextMenuId() {
    const maxId = menus.reduce((max, menu) => {
        const match = /^menu-(\d+)$/.exec(menu.id || '');
        if (!match) return max;
        const number = Number(match[1]);
        return Number.isFinite(number) ? Math.max(max, number) : max;
    }, 0);

    return `menu-${maxId + 1}`;
}

//=== IMPLEMENTASI SERVICE
// unary - ambil menu dan add menu
function GetMenu(call, callback) {
    try {
        log(`GetMenu request from ${call.getPeer()}`);
        callback(null, { menus });
    } catch (e) {
        callback({ code: grpc.status.INTERNAL, message: e.message });
    }
}

function AddMenu(call, callback) {
    try {
        const { name, description, price } = call.request;
        log(`AddMenu request -> name=${name || '-'} price=${price || '-'}`);
        if (!name || !price) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'Name and price are required'
            });
        }
        const newMenu = { id: getNextMenuId(), name, description, price };
        menus.push(newMenu);
        log(`AddMenu success -> id=${newMenu.id} totalMenus=${menus.length}`);
        callback(null, { success: true, menuId: newMenu.id, message: 'Menu added successfully' });
    } catch (e) {
        log(`AddMenu error -> ${e.message}`);
        callback({ code: grpc.status.INTERNAL, message: e.message });
    }
}

// bidirectional streaming - live voting 
function getVoteResults(sessionId, isFinal = false) {
    const session = voteSessions[sessionId] || { votes: {}, userChoices: {} };
    const totalVoters = Object.keys(session.userChoices || {}).length;
    return Object.entries(session.votes).map(([menuId, count]) => {
        const menu = menus.find(m => m.id === menuId);
        return {
            menuId,
            menuName: menu ? menu.name : 'Unknown',
            voteCount: count,
            isFinal,
            eventType: 'TALLY',
            totalVoters,
        };
    });
}

function getUserChoiceResults(sessionId, isFinal = false) {
    const session = voteSessions[sessionId] || { votes: {}, userChoices: {} };
    const results = [];
    Object.entries(session.userChoices || {}).forEach(([userId, selectedMenus]) => {
        const menuIds = Object.keys(selectedMenus || {}).filter((menuId) => selectedMenus[menuId]);
        menuIds.forEach((menuId) => {
            const menu = menus.find((m) => m.id === menuId);
            results.push({
                menuId,
                menuName: menu ? menu.name : 'Unknown',
                voteCount: session.votes[menuId] || 0,
                isFinal,
                eventType: 'USER_CHOICE',
                actorUserId: userId,
                actorMenuId: menuId,
                actorMenuName: menu ? menu.name : 'Unknown',
                totalVoters: Object.keys(session.userChoices || {}).length,
            });
        });
    });
    return results;
}

function broadcastToWatchers(sessionId, isFinal = false) {
    const session = voteSessions[sessionId];
    if (!session) return;
    const results = [...getUserChoiceResults(sessionId, isFinal), ...getVoteResults(sessionId, isFinal)];
    session.watchers = session.watchers || [];
    session.watchers.forEach(watchStream => {
        results.forEach(r => {
            try { watchStream.write(r); } catch (e) {}
        });
        if (isFinal) watchStream.end();
    });
}

function broadcastTallyToWatchers(sessionId) {
    const session = voteSessions[sessionId];
    if (!session) return;
    const results = getVoteResults(sessionId, false);
    session.watchers = session.watchers || [];
    session.watchers.forEach((watchStream) => {
        results.forEach((r) => {
            try { watchStream.write(r); } catch (e) {}
        });
    });
}

function VoteMenu(call) {
    let sessionId = null;
    const initializedUsers = new Set();

    log(`VoteMenu stream opened from ${call.getPeer()}`);

    call.on('data', (voteRequest) => {
        const userId = pick(voteRequest, 'userId', 'user_id');
        const menuId = pick(voteRequest, 'menuId', 'menu_id');
        const incomingSessionId = pick(voteRequest, 'sessionId', 'session_id');

        sessionId = sessionId || incomingSessionId || `session-${userId}`;
        if (!voteSessions[sessionId]) {
            voteSessions[sessionId] = { votes: {}, userChoices: {}, watchers: [] };
            log(`Vote session created -> ${sessionId}`);
        }

        if (!userId || !menuId) {
            log(`VoteMenu rejected -> session=${sessionId} reason=missing-user-or-menu`);
            call.write({
                menuId: menuId || '',
                menuName: 'Unknown',
                voteCount: 0,
                isFinal: false,
                eventType: 'ERROR',
            });
            return;
        }

        const menuExists = menus.find(m => m.id === menuId);
        if (!menuExists) {
            log(`VoteMenu rejected -> session=${sessionId} user=${userId} menu=${menuId} reason=unknown-menu`);
            call.write({ menuId, menuName: 'Unknown', voteCount: 0, isFinal: false, eventType: 'ERROR' });
        return;
        }

        const session = voteSessions[sessionId];
        // One user one ballot: pada kiriman pertama user di stream ini, reset ballot lama user.
        if (!initializedUsers.has(userId)) {
            const previousChoices = session.userChoices[userId] || {};
            Object.keys(previousChoices).forEach((oldMenuId) => {
                session.votes[oldMenuId] = Math.max((session.votes[oldMenuId] || 1) - 1, 0);
                if (session.votes[oldMenuId] === 0) delete session.votes[oldMenuId];
            });
            session.userChoices[userId] = {};
            initializedUsers.add(userId);
        }

        const userBallot = session.userChoices[userId] || {};
        if (userBallot[menuId]) {
            log(`Vote no change -> session=${sessionId} user=${userId} menu=${menuId}`);
            try {
                call.write({
                    menuId,
                    menuName: menuExists.name,
                    voteCount: session.votes[menuId] || 0,
                    isFinal: false,
                    eventType: 'NO_CHANGE',
                    actorUserId: userId,
                    actorMenuId: menuId,
                    actorMenuName: menuExists.name,
                    totalVoters: Object.keys(session.userChoices).length,
                });
            } catch (e) {}
            return;
        }

        userBallot[menuId] = true;
        session.userChoices[userId] = userBallot;
        session.votes[menuId] = (session.votes[menuId] || 0) + 1;

        log(`Vote recorded -> session=${sessionId} user=${userId} menu=${menuId} count=${session.votes[menuId]} selectedByUser=${Object.keys(userBallot).length} voters=${Object.keys(session.userChoices).length}`);

        const userChoiceEvent = {
            menuId,
            menuName: menuExists.name,
            voteCount: session.votes[menuId] || 0,
            isFinal: false,
            eventType: 'USER_CHOICE',
            actorUserId: userId,
            actorMenuId: menuId,
            actorMenuName: menuExists.name,
            totalVoters: Object.keys(session.userChoices).length,
        };

        try { call.write(userChoiceEvent); } catch (e) {}

        session.watchers.forEach((watchStream) => {
            try { watchStream.write(userChoiceEvent); } catch (e) {}
        });

        const results = getVoteResults(sessionId, false);
        results.forEach(r => call.write(r));

        broadcastTallyToWatchers(sessionId);
    });

    call.on('end', () => {
        log(`VoteMenu stream ended -> session=${sessionId || '-'}`);
        // JANGAN broadcast dengan isFinal=true karena satu voter keluar bukan berarti voting selesai
        call.end();
    });

    call.on('error', (e) => {
        log(`VoteMenu stream error -> ${e.message}`);
    });
}

function WatchVoteResult(call) {
    const sessionId = pick(call.request, 'sessionId', 'session_id');

    log(`WatchVoteResult opened -> session=${sessionId} peer=${call.getPeer()}`);

    if(!voteSessions[sessionId]){
        voteSessions[sessionId] = { votes: {}, userChoices: {}, watchers: []};
        log(`WatchVoteResult created empty session -> ${sessionId}`);
    }
    voteSessions[sessionId].watchers = voteSessions[sessionId].watchers || [];
    voteSessions[sessionId].watchers.push(call);
    log(`Watcher registered -> session=${sessionId} watchers=${voteSessions[sessionId].watchers.length}`);

    const current = [...getUserChoiceResults(sessionId, false), ...getVoteResults(sessionId, false)];
    current.forEach(r => call.write(r));

    call.on('cancelled', () => {
        const watchers = voteSessions[sessionId]?.watchers || [];
        const idx = watchers.indexOf(call);
        if(idx !== -1) watchers.splice(idx, 1);
        log(`Watcher cancelled -> session=${sessionId} watchers=${watchers.length}`);
    });
}

// start server

const server = new grpc.Server();
server.addService(proto.MenuService.service, { GetMenu, AddMenu, VoteMenu, WatchVoteResult});

server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
        console.error('[menu] server gagal start:', err.message);
        return;
    }
    console.log(`[menu] server running on port ${port}`);
});