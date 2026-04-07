const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { randomUUID } = require('crypto');

const packageDef = protoLoader.loadSync('proto/order.proto');
const proto = grpc.loadPackageDefinition(packageDef).order;

// Load nutrition proto untuk memanggil AddUserCalories
const nutritionPackageDef = protoLoader.loadSync('proto/nutrition.proto');
const nutritionProto = grpc.loadPackageDefinition(nutritionPackageDef).nutrition;
const nutritionClient = new nutritionProto.NutritionService(
    'localhost:50052',
    grpc.credentials.createInsecure()
);

function pick(req, camel, snake) {
    return req[camel] ?? req[snake];
}

function log(message) {
    console.log(`[order] ${message}`);
}

// Helper untuk panggil gRPC AddUserCalories (unary call as promise)
function callAddUserCalories(userId, menuId) {
    return new Promise((resolve, reject) => {
        const request = { userId, menuId };
        log(`Debug: sending AddUserCalories request: ${JSON.stringify(request)}`);
        nutritionClient.AddUserCalories(request, (err, response) => {
            if (err) reject(err);
            else resolve(response);
        });
    });
}

//Internal memory state
//orders: { orderId: {userId, groupId, items, total, status, createdAt} }
const  orders = {};
const STATUS_FLOW = ['RECEIVED', 'PREPARING', 'READY', 'DELIVERED'];

//implementasi grpc
//unary -> order baru
function CreateOrder(call, callback) {
    (async () => {
        try {
            const userId = pick(call.request, 'userId', 'user_id');
            const groupId = pick(call.request, 'groupId', 'group_id');
            const { items } = call.request;

            log(`CreateOrder request -> userId=${userId || '-'} groupId=${groupId || '-'} items=${items?.length || 0} peer=${call.getPeer()}`);

            if (!userId || !groupId || !items || items.length === 0) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'user_id, group_id, items tidak boleh kosong',
                });
            }
            const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
            const orderId = randomUUID();

            orders[orderId] = {
                userId,
                groupId,
                items,
                total,
                status: 'RECEIVED',
                createdAt: Date.now(),
            };

            // Tambahkan kalori user untuk setiap menu di order ini (via gRPC to nutrition service)
            for (const item of items) {
                const menuId = pick(item, 'menuId', 'menu_id');
                try {
                    await callAddUserCalories(userId, menuId);
                } catch (nutritionErr) {
                    log(`CreateOrder warning -> Failed to add calories for ${menuId}: ${nutritionErr.message}`);
                    // Tidak error, hanya warning. Order tetap dibuat.
                }
            }

            log(`CreateOrder success -> orderId=${orderId} total=${total} items=${items.length}`);
            callback(null, {
                success: true,
                orderId,
                message: `order berhasil dibuat! Total: Rp${total.toLocaleString('id-ID')}`,
            });
        } catch (e) {
            log(`CreateOrder error -> ${e.message}`);
            callback({code: grpc.status.INTERNAL, message: e.message});
        }
    })();
}

//unary -> split bill

function SplitBill(call, callback) {
    try {
        const orderId = pick(call.request, 'orderId', 'order_id');
        const userIds = pick(call.request, 'userIds', 'user_ids');

        log(`SplitBill request -> orderId=${orderId || '-'} users=${userIds?.length || 0} peer=${call.getPeer()}`);

        const order = orders[orderId];
        if(!order) {
            log(`SplitBill not found -> orderId=${orderId}`);
            return callback({
                code: grpc.status.NOT_FOUND,
                message: `Order '${orderId}' tidak ditemukan`,
            });
        }
        if(!userIds || userIds.length === 0) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: `user_ids wajib diisi minimal satu`,
            });
        }
        const perPerson = parseFloat((order.total / userIds.length).toFixed(2));
        const bills = userIds.map(uid => ({ userId: uid, amount: perPerson }));

        log(`SplitBill success -> orderId=${orderId} total=${order.total} perPerson=${perPerson}`);

        callback(null, {
            orderId,
            total: order.total,
            bills,
        });
    } catch(e){
        log(`SplitBill error -> ${e.message}`);
        callback({code: grpc.status.INTERNAL, message: e.message });
    }
}

//Server streaming -> track status order secara real time
function TrackOrderStatus(call) {
    const orderId = pick(call.request, 'orderId', 'order_id');
    const order = orders[orderId];

    log(`TrackOrderStatus opened -> orderId=${orderId || '-'} peer=${call.getPeer()}`);

    if(!order) {
        log(`TrackOrderStatus not found -> orderId=${orderId}`);
        call.destroy({
            code: grpc.status.NOT_FOUND,
            message: `Order '${orderId}' tidak ditemukan`,
        });
        return;
    }
    log(`TrackOrderStatus started -> orderId=${orderId} status=${order.status}`);
    let currentStatusIndex = STATUS_FLOW.indexOf(order.status);

    call.write({
        orderId,
        status: STATUS_FLOW[currentStatusIndex],
        message: `Status terkini: '${STATUS_FLOW[currentStatusIndex]}'`,
        timestamp: Date.now(),
    });

    //simulasi status di update setiap 10 detik

    const interval = setInterval(()=> {
        currentStatusIndex++;
        if(currentStatusIndex >= STATUS_FLOW.length) {
            clearInterval(interval);
            log(`TrackOrderStatus finished -> orderId=${orderId}`);
            call.end();
            return;
        }

        const status = STATUS_FLOW[currentStatusIndex];
        orders[orderId].status = status;

        const messages = {
            PREPARING: 'Chef sedang memasak',
            READY : 'Pesanan siap',
            DELIVERED : 'Pesanan diterima',
        };

        try {
            call.write({
                orderId,
                status,
                message: messages[status] || status,
                timestamp: Date.now(),
            });
            log(`TrackOrderStatus update -> orderId=${orderId} status=${status}`);
        } catch (e) {
            log(`TrackOrderStatus write error -> ${e.message}`);
            clearInterval(interval);
        }
    }, 10000);

    call.on('cancelled', () => {
        log(`TrackOrderStatus cancelled -> orderId=${orderId}`);
        clearInterval(interval);
    });
    call.on('error', () => clearInterval(interval));
}

// start server
const server = new grpc.Server();
server.addService(proto.OrderService.service, {
    CreateOrder,
    SplitBill,
    TrackOrderStatus,
});
server.bindAsync('0.0.0.0:50053', grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
        console.error('[order] server gagal start:', err.message);
        return;
    }
    console.log(`[order] server running on port ${port}`); 
});