const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const { v4: uuidv4 } = require('uuid');

const packageDef = protoLoader.loadSync('proto/menu.proto');
const proto = grpc.loadPackageDefinition(packageDef).menu;

//=== IN MEMORY STATE
const menus = [
    { id: 'menu-1', name: 'Nasi Goreng', description: 'Nasi goreng dengan telur dan sayuran', price: 15000 },
    { id: 'menu-2', name: 'Mie Ayam', description: 'Mie ayam dengan kuah kaldu dan potongan ayam', price: 12000 },
    { id: 'menu-3', name: 'Sate Ayam', description: 'Sate ayam bagian dada dengan bumbu kacang', price: 20000 },
    { id: 'menu-4', name: 'Gado-Gado', description: 'Salad sayuran dengan bumbu kacang', price: 18000 }
];

const voteSessions = {};

//=== IMPLEMENTASI SERVICE
// unary - ambil menu dan add menu
function GetMenu(call, callback) {
    try {
        callback(null, { menus });
    } catch (e) {
        callback({ code: grpc.status.INTERNAL, message: e.message });
    }
}

function AddMenu(call, callback) {
    try {
        const { name, description, price } = call.request;
        if (!name || !price) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'Name and price are required'
            });
        }
        const newMenu = { id: uuidv4(), name, description, price };
        menus.push(newMenu);
        callback(null, { success: true, menu_id: newMenu.id, message: 'Menu added successfully' });
    } catch (e) {
        callback({ code: grpc.status.INTERNAL, message: e.message });
    }
}

// bidirectional streaming - live votung 
function getVoteResults(sessionId, isFinal = false) {
    const session = voteSessions[sessionId] || { votes: {} };
    return Object.entries(session.votes).map(([menuId, count]) => {
        const menu = menus.find(m => m.id === menuId);
        return {
            menu_id: menuId,
            menu_name: menu ? menu.name : 'Unknown',
            vote_count: count,
            is_final: isFinal,
        };
    });
}

function broadcastToWatchers(sessionId, isFinal = false) {
    const session = voteSessions[sessionId];
    if (session) return;
    const results = getVoteResults(sessionId, isFinal);
    session.watchers = session.watchers || [];
    session.watchers.forEach(watchStream => {
        results.forEach(r => {
            try { watchStream.write(r); } catch (e) {}
        });
        if (isFinal) watchStream.end();
    });
}

function VoteMenu(call) {
    let sessionId = null;
    call.on('data', (voteRequest) => {
        const { user_id, menu_id } = voteRequest;

        // Pakai user_id sebagai session identifier simpelnya
        sessionId = sessionId || `session-${user_id}`;
        if (!voteSessions[sessionId]) {
        voteSessions[sessionId] = { votes: {}, watchers: [] };
        }

        // Cek menu valid
        const menuExists = menus.find(m => m.id === menu_id);
        if (!menuExists) {
        call.write({ menu_id, menu_name: 'Unknown', vote_count: 0, is_final: false });
        return;
        }
        const session = voteSessions[sessionId];
        session.votes[menu_id] = (session.votes[menu_id] || 0) + 1;

        const results = getVoteResults(sessionId, false);
        results.forEach(r => call.write(r));

        broadcastToWatchers(sessionId, false);
    });
}