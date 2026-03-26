const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const packageDef = protoLoader.loadSync('proto/nutrition.proto', {keepCase: true});
const proto = grpc.loadPackageDefinition(packageDef).nutrition;

//==In memory state
const nutritionData = {
    'menu-1': {menu_name: 'Nasi Goreng', calories: 500, protein: 15, carbs: 70, fat: 18 },
    'menu-2': {menu_name: 'Mie Ayam', calories: 600, protein: 17, carbs: 85, fat: 14 },
    'menu-3': {menu_name: 'Sate Ayam', calories: 650, protein: 19, carbs: 50, fat: 20 },
    'menu-4': {menu_name: 'Gado-Gado', calories: 450, protein: 10, carbs: 45, fat: 19},
};
//log makanan harian user { userId: {date: string, totalCalories: number}}
const userDailyLog = {};
const CALORIE_LIMIT = 2000;

//==Implementasi grpc
//unary - cek nutrisi satu menu dan total kalori/hari user
function GetNutrition(call, callback) {
    try {
        const { menu_id } = call.request;
        console.log(`GetNutrition dipanggil dengan menu_id: ${menu_id}`);
        const data = nutritionData[menu_id];
        if(!data) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: `Menu dengan id ${menu_id} tidak ditemukan`,
            });
        }
        callback(null, { menu_id, ...data });
    } catch(e) {
        callback({ code: grpc.status.INTERNAL, message: e.message});
    }
}

function GetDailySummary(call, callback) {
    try {
        const { user_id, date } = call.request;
        if (!user_id || !date ) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT, 
                message: 'user_id dan date wajib diisi',
            });
        }
        const key = `${user_id}:${date}`;
        const totalCalories = userDailyLog[key]?.totalCalories || 0;
        const isOverLimit = totalCalories > CALORIE_LIMIT;

        callback(null, {
            user_id,
            total_calories: totalCalories,
            calorie_limit: CALORIE_LIMIT,
            is_over_limit: isOverLimit,
        });
    } catch(e) {
        callback({ code: grpc.status.INTERNAL, message: e.message});
    }
}

// Server streaming - monitor kalori user
function StreamDailyProgress(call) {
    const{ user_id } = call.request;

    if(!user_id) {
        call.destroy({
            code: grpc.status.INVALID_ARGUMENT,
            message: 'user_id wajib diisi',
        });
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const key = `${user_id}:${today}`;
    //kirim update tiap 5 detik selama 30 detik
    let tick = 0;
    const MAX_TICK = 6;

    const interval = setInterval(() => {
        const totalCalories = userDailyLog[key]?.totalCalories || 0;
        const percentage = (totalCalories/CALORIE_LIMIT) * 100;

        let warningMessage = '';
        if(percentage >= 100) warningMessage = 'Kalori harian sudah melebihi batas!';
        else if (percentage >= 80) warningMessage = 'Kalori mencapai 80%, hati-hati!';
        else warningMessage = 'Kalori masih aman';

        try {
            call.write({
                current_calories: totalCalories,
                calorie_limit: CALORIE_LIMIT,
                percentage: parseFloat(percentage.toFixed(2)),
                warning_message: warningMessage,
            });
        } catch (e) {
            clearInterval(interval);
            return;
        }

        tick++;
        if(tick >= MAX_TICK) {
            clearInterval(interval);
            call.end();
        }
    }, 3000);

    call.on('cancelled', () => clearInterval(interval));
    call.on('error', () => clearInterval(interval));
}

//export log ke order-server
function addCaloriesToUser(userId, menuId) {
    const today = new Date().toISOString().split('T')[0];
    const key = `${userId}:${today}`;
    const calories = nutritionData[menuId]?.calories || 0;

    if(!userDailyLog[key]) userDailyLog[key] = { totalCalories: 0};
    userDailyLog[key].totalCalories += calories;
}
module.exports = { addCaloriesToUser };

// start server
const server = new grpc.Server();
server.addService(proto.NutritionService.service, { GetNutrition, GetDailySummary, StreamDailyProgress, });

server.bindAsync('0.0.0.0:50052', grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
        console.error('Nutrition server gagal start:', err.message);
        return;
    }
    console.log(`Nutrition server running on port ${port}`);   
});