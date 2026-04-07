const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { nutritionData, userDailyLog, CALORIE_LIMIT, log } = require('./nutrition-helpers');

const packageDef = protoLoader.loadSync('proto/nutrition.proto', {keepCase: true});
const proto = grpc.loadPackageDefinition(packageDef).nutrition;

function pick(req, camel, snake) {
    return req[camel] ?? req[snake];
}

//==Implementasi grpc
//unary - cek nutrisi satu menu dan total kalori/hari user
function GetNutrition(call, callback) {
    try {
        const menuId = pick(call.request, 'menuId', 'menu_id') || call.request.menu;
        log(`GetNutrition request -> menuId=${menuId || '-'} peer=${call.getPeer()}`);
        const data = nutritionData[menuId];
        if(!data) {
            log(`GetNutrition not found -> menuId=${menuId}`);
            return callback({
                code: grpc.status.NOT_FOUND,
                message: `Nutrisi untuk menu ${menuId} belum ditambahkan`,
            });
        }
        log(`GetNutrition success -> menuId=${menuId} calories=${data.calories}`);
        callback(null, { menuId, ...data });
    } catch(e) {
        log(`GetNutrition error -> ${e.message}`);
        callback({ code: grpc.status.INTERNAL, message: e.message});
    }
}

function AddNutrition(call, callback) {
    try {
        const menuId = pick(call.request, 'menuId', 'menu_id');
        const menuName = pick(call.request, 'menuName', 'menu_name');
        const calories = Number(call.request.calories);
        const protein = Number(call.request.protein);
        const carbs = Number(call.request.carbs);
        const fat = Number(call.request.fat);

        log(`AddNutrition request -> menuId=${menuId || '-'} menuName=${menuName || '-'} peer=${call.getPeer()}`);

        if (!menuId || !menuName) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'menu_id dan menu_name wajib diisi',
            });
        }

        if (![calories, protein, carbs, fat].every(Number.isFinite)) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'calories, protein, carbs, fat harus berupa angka',
            });
        }

        if ([calories, protein, carbs, fat].some((value) => value < 0)) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'nilai nutrisi tidak boleh negatif',
            });
        }

        nutritionData[menuId] = {
            menu_name: menuName,
            calories,
            protein,
            carbs,
            fat,
        };

        log(`AddNutrition success -> menuId=${menuId} calories=${calories}`);

        callback(null, {
            success: true,
            message: `Nutrisi untuk ${menuId} berhasil disimpan`,
        });
    } catch (e) {
        log(`AddNutrition error -> ${e.message}`);
        callback({ code: grpc.status.INTERNAL, message: e.message });
    }
}

function GetDailySummary(call, callback) {
    try {
        const userId = pick(call.request, 'userId', 'user_id');
        const { date } = call.request;
        log(`GetDailySummary request -> userId=${userId || '-'} date=${date || '-'} peer=${call.getPeer()}`);
        if (!userId || !date ) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT, 
                message: 'user_id dan date wajib diisi',
            });
        }
        const key = `${userId}:${date}`;
        const totalCalories = userDailyLog[key]?.totalCalories || 0;
        const isOverLimit = totalCalories > CALORIE_LIMIT;

        log(`GetDailySummary result -> userId=${userId} totalCalories=${totalCalories} limit=${CALORIE_LIMIT} over=${isOverLimit}`);

        callback(null, {
            userId,
            totalCalories,
            calorieLimit: CALORIE_LIMIT,
            isOverLimit,
        });
    } catch(e) {
        log(`GetDailySummary error -> ${e.message}`);
        callback({ code: grpc.status.INTERNAL, message: e.message});
    }
}

// Server streaming - monitor kalori user
function StreamDailyProgress(call) {
    const userId = pick(call.request, 'userId', 'user_id');

    log(`StreamDailyProgress opened -> userId=${userId || '-'} peer=${call.getPeer()}`);

    if(!userId) {
        call.destroy({
            code: grpc.status.INVALID_ARGUMENT,
            message: 'user_id wajib diisi',
        });
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const key = `${userId}:${today}`;
    // kirim update terus menerus sampai stream dibatalkan client

    const interval = setInterval(() => {
        const totalCalories = userDailyLog[key]?.totalCalories || 0;
        const percentage = (totalCalories/CALORIE_LIMIT) * 100;

        let warningMessage = '';
        if(percentage >= 100) warningMessage = 'Kalori harian sudah melebihi batas!';
        else if (percentage >= 80) warningMessage = 'Kalori mencapai 80%, hati-hati!';
        else warningMessage = 'Kalori masih aman';

        try {
            call.write({
                currentCalories: totalCalories,
                calorieLimit: CALORIE_LIMIT,
                percentage: parseFloat(percentage.toFixed(2)),
                warningMessage,
            });
            log(`StreamDailyProgress tick -> userId=${userId} calories=${totalCalories} percentage=${percentage.toFixed(2)} warning="${warningMessage}"`);
        } catch (e) {
            log(`StreamDailyProgress write error -> ${e.message}`);
            clearInterval(interval);
            return;
        }
    }, 3000);

    call.on('cancelled', () => clearInterval(interval));
    call.on('error', () => clearInterval(interval));
}

// Unary - tambah kalori user (dipanggil dari order-server untuk setiap item)
function AddUserCalories(call, callback) {
    try {
        log(`Debug: Full request: ${JSON.stringify(call.request)}`);
        log(`Debug: Request keys: ${Object.keys(call.request).join(', ')}`);
        
        // Try both snake_case dan camelCase
        const userId = call.request.user_id || call.request.userId || '';
        const menuId = call.request.menu_id || call.request.menuId || '';

        log(`AddUserCalories request -> userId="${userId}" menuId="${menuId}" peer=${call.getPeer()}`);

        // Cek apakah field benar-benar kosong (empty string atau undefined)
        if (!userId.trim() || !menuId.trim()) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: `user_id dan menu_id wajib diisi (userId="${userId}", menuId="${menuId}")`,
            });
        }

        const today = new Date().toISOString().split('T')[0];
        const key = `${userId}:${today}`;
        const calories = nutritionData[menuId]?.calories || 0;

        if (calories === 0 && !nutritionData[menuId]) {
            log(`AddUserCalories not found -> menuId=${menuId}`);
            return callback({
                code: grpc.status.NOT_FOUND,
                message: `Menu ${menuId} atau nutrisinya belum ada`,
            });
        }

        if (!userDailyLog[key]) userDailyLog[key] = { totalCalories: 0 };
        userDailyLog[key].totalCalories += calories;

        log(`AddUserCalories success -> userId=${userId} menuId=${menuId} calories=${calories} total=${userDailyLog[key].totalCalories}`);

        callback(null, {
            success: true,
            message: `Kalori untuk ${menuId} berhasil ditambahkan`,
            totalCalories: userDailyLog[key].totalCalories,
        });
    } catch (e) {
        log(`AddUserCalories error -> ${e.message}`);
        callback({ code: grpc.status.INTERNAL, message: e.message });
    }
}

// start server
const server = new grpc.Server();
server.addService(proto.NutritionService.service, { GetNutrition, AddNutrition, GetDailySummary, StreamDailyProgress, AddUserCalories });

server.bindAsync('0.0.0.0:50052', grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
        console.error('[nutrition] server gagal start:', err.message);
        return;
    }
    console.log(`[nutrition] server running on port ${port}`);   
});