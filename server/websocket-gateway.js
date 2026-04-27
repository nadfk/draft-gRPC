const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { WebSocketServer } = require('ws');
const http = require('http');

const menuDef = protoLoader.loadSync('proto/menu.proto', { keepCase: true });
const nutritionDef = protoLoader.loadSync('proto/nutrition.proto', { keepCase: true });
const orderDef = protoLoader.loadSync('proto/order.proto', { keepCase: true });

const menuProto = grpc.loadPackageDefinition(menuDef).menu;
const nutritionProto = grpc.loadPackageDefinition(nutritionDef).nutrition;
const orderProto = grpc.loadPackageDefinition(orderDef).order;

const menuClient = new menuProto.MenuService('localhost:50051', grpc.credentials.createInsecure());
const nutritionClient = new nutritionProto.NutritionService('localhost:50052', grpc.credentials.createInsecure());
const orderClient = new orderProto.OrderService('localhost:50053', grpc.credentials.createInsecure());

function pick(obj, snake, camel) {
	if (!obj) return undefined;
	if (Object.prototype.hasOwnProperty.call(obj, snake)) return obj[snake];
	return obj[camel];
}

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket Gateway Running\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');
    const activeStreams = new Set();

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            handleClientMessage(ws, msg, activeStreams);
        } catch (error) {
            console.error('Failed to parse message', error);
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid JSON message' }));
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
        for (const stream of activeStreams) {
            stream.cancel();
        }
        activeStreams.clear();
    });
});

function handleClientMessage(ws, msg, activeStreams) {
    const { action, payload, requestId } = msg; // requestId for Unary Promises

    // Helper to send unary response with requestId
    const respond = (err, data) => {
        if (err) {
            ws.send(JSON.stringify({ type: 'ERROR', action, requestId, message: err.message }));
        } else {
            ws.send(JSON.stringify({ type: 'RESPONSE', action, requestId, payload: data }));
        }
    };

    switch (action) {
        // --- 1. Lihat Menu ---
        case 'getMenu': {
            menuClient.GetMenu({}, respond);
            break;
        }

        // --- 2. Tambah Menu ---
        case 'addMenu': {
            menuClient.AddMenu(payload, respond);
            break;
        }

        // --- 2.b Tambah Nutrisi Menu ---
        case 'addNutrition': {
            nutritionClient.AddNutrition(payload, respond);
            break;
        }

        // --- 3. Cek Nutrisi ---
        case 'getNutrition': {
            nutritionClient.GetNutrition(payload, respond);
            break;
        }

        // --- 4. Rangkuman Nutrisi Harian ---
        case 'getDailySummary': {
            nutritionClient.GetDailySummary(payload, respond);
            break;
        }

        // --- 5. Buat Order ---
        case 'createOrder': {
            orderClient.CreateOrder(payload, respond);
            break;
        }

        // --- 6. Split Bill ---
        case 'splitBill': {
            orderClient.SplitBill(payload, respond);
            break;
        }

        // --- 10. Proses Live Voting ---
        case 'voteMenu': {
            const voteStream = menuClient.VoteMenu();
            voteStream.on('data', (data) => {
                ws.send(JSON.stringify({ type: 'EVENT', eventType: 'VOTE_UPDATE', payload: data }));
            });
            voteStream.on('error', (err) => {
                if (err.code !== grpc.status.CANCELLED) {
                    ws.send(JSON.stringify({ type: 'ERROR', action, message: err.message }));
                }
            });
            voteStream.write(payload);
            voteStream.end();
            if (requestId) respond(null, { success: true }); // ACK for UI Promise
            break;
        }

        // --- Subscriptions (Server-Initiated Events) ---
        // --- 7. Lihat Progress Live Voting ---
        case 'watchVoteResult': {
            const watcher = menuClient.WatchVoteResult(payload);
            activeStreams.add(watcher);
            
            watcher.on('data', (data) => {
                ws.send(JSON.stringify({ type: 'EVENT', eventType: 'VOTE_RESULT', payload: data }));
            });
            watcher.on('error', (err) => {
                if (err.code !== grpc.status.CANCELLED) {
                    ws.send(JSON.stringify({ type: 'ERROR', action, message: err.message }));
                }
                activeStreams.delete(watcher);
            });
            watcher.on('end', () => activeStreams.delete(watcher));
            if (requestId) respond(null, { success: true });
            break;
        }

        // --- 8. Progress Kalori Harian ---
        case 'streamDailyProgress': {
            const progressStream = nutritionClient.StreamDailyProgress(payload);
            activeStreams.add(progressStream);
            
            progressStream.on('data', (data) => {
                ws.send(JSON.stringify({ type: 'EVENT', eventType: 'NUTRITION_PROGRESS', payload: data }));
            });
            progressStream.on('error', (err) => {
                if (err.code !== grpc.status.CANCELLED) {
                    ws.send(JSON.stringify({ type: 'ERROR', action, message: err.message }));
                }
                activeStreams.delete(progressStream);
            });
            progressStream.on('end', () => activeStreams.delete(progressStream));
            if (requestId) respond(null, { success: true });
            break;
        }

        // --- 9. Track Order Status ---
        case 'trackOrderStatus': {
            const trackStream = orderClient.TrackOrderStatus(payload);
            activeStreams.add(trackStream);
            
            trackStream.on('data', (data) => {
                ws.send(JSON.stringify({ type: 'EVENT', eventType: 'ORDER_STATUS', payload: data }));
            });
            trackStream.on('error', (err) => {
                if (err.code !== grpc.status.CANCELLED) {
                    ws.send(JSON.stringify({ type: 'ERROR', action, message: err.message }));
                }
                activeStreams.delete(trackStream);
            });
            trackStream.on('end', () => activeStreams.delete(trackStream));
            if (requestId) respond(null, { success: true });
            break;
        }

        default:
            ws.send(JSON.stringify({ type: 'ERROR', message: `Unknown action: ${action}` }));
    }
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`WebSocket Gateway listening on port ${PORT}`);
});
