const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { v4: uuidv4 } = require('uuid');

const packageDef = protoLoader.loadSync('proto/order.proto', {keepCase: true});
const proto = grpc.loadPackageDefinition(packageDef).order;

//Internal memory state
//orders: { orderId: {userId, groupId, items, total, status, createdAt} }
const  orders = {};
const STATUS_FLOW = ['RECEIVED', 'PREPARING', 'READY', 'DELIVERED'];

//implementasi grpc
//unary -> order baru
function CreateOrder(call, callback) {
    try {
        const { user_id, group_id, items } = call.request;

        if (!user_id || !group_id || !items || items.length === 0) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'user_id, group_id, items tidak boleh kosong',
            });
        }
        const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const orderId = uuidv4();

        orders[orderId] = {
            user_id,
            group_id,
            items,
            total,
            status: 'RECEIVED',
            createdAt: Date.now(),
        };
        console.log(`Order baru: ${orderId} dari user ${user_id}`);
        callback(null, {
            success: true,
            order_id: orderId,
            message: `order berhasil dibuat! Total: Rp${total.toLocaleString('id-ID')}`,
        });
    } catch (e) {
        callback({code: grpc.status.INTERNAL, message: e.message});
    }
}

//unary -> split bill

function SplitBill(call, callback) {
    try {
        const { order_id, user_ids } = call.request;

        const order = orders[order_id];
        if(!order) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: `Order '${order_id}' tidak ditemukan`,
            });
        }
        if(!user_ids || !user_ids.length === 0) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: `user_ids wajib diisi minimal satu`,
            });
        }
        const perPerson = parseFloat((order.total / user_ids.length).toFixed(2));
        const bills = user_ids.map(uid => ({user_id: uid, amount: perPerson }));

        callback(null, {
            order_id,
            total: order.total,
            bills,
        });
    } catch(e){
        callback({code: grpc.status.INTERNAL, message: e.message });
    }
}

//Server streaming -> track status order secara real time
function TrackOrderStatus(call) {
    const { order_id } = call.request;
    const order = orders[order_id];

    if(!order) {
        call.destroy({
            code: grpc.status.NOT_FOUND,
            message: `Order '${order_id}' tidak ditemukan`,
        });
        return;
    }
    console.log(`Tracking order '${order_id}' dimulai...`);
    let currentStatusIndex = STATUS_FLOW.indexOf(order.status);

    call.write({
        order_id,
        status: STATUS_FLOW[currentStatusIndex],
        message: `Status terkini: '${STATUS_FLOW[currentStatusIndex]}'`,
        timestamp: Date.now(),
    });

    //simulasi status di update setiap 10 detik

    const interval = setInterval(()=> {
        currentStatusIndex++;
        if(currentStatusIndex >= STATUS_FLOW.length) {
            clearInterval(interval);
            call.end();
            return;
        }

        const status = STATUS_FLOW[currentStatusIndex];
        orders[order_id].status = status;

        const messages = {
            PREPARING: 'Chef sedang memasak',
            READY : 'Pesanan siap',
            DELIVERED : 'Pesanan diterima',
        };

        try {
            call.write({
                order_id,
                status,
                message: messages[status] || status,
                timestamp: Date.now(),
            });
        } catch (e) {
            clearInterval(interval);
        }
    }, 10000);

    call.on('cancelled', () => {
        console.log(`Tracking dibatalkan untuk order: ${order_id}`);
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
        console.error('Order Server gagal start:', err.message);
        return;
    }
    console.log(`Order server running on port ${port}`); 
});