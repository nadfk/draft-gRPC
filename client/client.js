//untuk testing sebagai user

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const menuProto = grpc.loadPackageDefinition(protoLoader.loadSync('proto/menu.proto', {keepCase: true})).menu;
const nutritionProto = grpc.loadPackageDefinition(protoLoader.loadSync('proto/nutrition.proto', {keepCase: true})).nutrition;
const orderProto = grpc.loadPackageDefinition(protoLoader.loadSync('proto/order.proto', {keepCase: true})).order;

//inisialisasi client
const menuClient = new menuProto.MenuService('localhost:50051', grpc.credentials.createInsecure());
const nutritionClient = new nutritionProto.NutritionService('localhost:50052', grpc.credentials.createInsecure());
const orderClient = new orderProto.OrderService('localhost:50053', grpc.credentials.createInsecure());

const delay = (ms) => new Promise(res => setTimeout(res, ms));
const divider = (title) => console.log(`\n${'='.repeat(50)}\n ${title}\n${'='.repeat(50)}`);

//1. get menu (unary)
function testGetMenu() {
    return new Promise((resolve, reject) => {
        divider('Test 1: Get Menu (Unary)');
        menuClient.GetMenu({}, (err, response) => {
            if (err) {
                console.error('GetMenu error:', err.message);
                return reject(err);
            }
            console.log('Daftar menu:');
            response.menus.forEach(m => {
                console.log(`    -[${m.id}] ${m.name} -- Rp${m.price.toLocaleString('id-ID')}`); 
            });
            resolve(response.menus);
        });
    });
}

//2. add menu (unary)
function testAddMenu(){
    return new Promise((resolve, reject)=> {
        divider('Test 2: Add Menu (Unary)');
        menuClient.AddMenu(
            { name: 'Soto Ayam', description: 'Soto ayam kuah bening', price: 14000 },
            (err, response) => {
                if(err) {
                    console.error('AddMenu error:', err.message);
                    return reject(err);
                }
                console.log('Menu ditambahkan...');
                console.log(`    - ID : ${response.menu_id}`);
                console.log(`    - Message: ${response.message}`);
                resolve(response.menu_id);
            }
        );
    });
}

//3 get nutrition (unary)
function testGetNutrition() {
    return new Promise((resolve, reject)=> {
        divider('Test 3: GetNutrition (Unary)');
        nutritionClient.GetNutrition({ menu_id: 'menu-1' }, (err, response) => {
            if(err) {
                console.error('GetNutrition error:', err.message);
                return reject(err);
            }
            console.log('Info Nutrisi Nasi Goreng:');
            console.log(`    Kalori  : ${response.calories} kcal`);
            console.log(`    Protein : ${response.protein} g`);
            console.log(`    Karbo   : ${response.carbs} g`);
            console.log(`    Lemak   : ${response.fat} g`);
            resolve();
        });
    });
}

//4. get daily summary (unary)
function testGetDailySummary() {
    return new Promise((resolve, reject) => {
        divider('Test 4: GetDailySummary (Unary)');
        const today = new Date().toISOString().split('T')[0];
        nutritionClient.GetDailySummary({user_id: 'user-prabowo', date: today }, (err, response) => {
            if(err) {
                console.error('GetDailySummary error:', err.message);
                return reject(err);
            }
            console.log('Ringkasan Kalori Harian:');
            console.log(`     Total Kalori: ${response.total_calories} kcal`);
            console.log(`     Batas       : ${response.calorie_limit} kcal`);
            console.log(`     Over Limit? : ${response.is_over_limit ? 'YA' : 'TIDAK'}`);
            resolve();         
        });
    });
}

//5. create order (unary) 
function testCreateOrder() {
    return new Promise((resolve, reject) => {
        divider('Test 5: CreateOrder (Unary)');
        orderClient.CreateOrder(
            {
                user_id: 'user-prabowo',
                group_id: 'danantara',
                items: [
                    {menu_id: 'menu-1', menu_name: 'Nasi Goreng',  quantity: 2, price: 15000},
                    {menu_id: 'menu-2', menu_name: 'Mie Ayam', quantity: 3, price: 12000},
                ],
            },
            (err, response) => {
                if(err){
                    console.error('CreateOrder error:', err.message);
                    return reject(err);
                }
                console.log('Order telah dibuat');
                console.log(`    Order ID: ${response.order_id}`);
                console.log(`    Message: ${response.message}`);
                resolve(response.order_id);
            }
        );
    });
}

//6. Split bill (Unary)
function testSplitBill(orderId){
    return new Promise((resolve, reject) => {
        divider('Test 6: SplitBill (Unary)');
        orderClient.SplitBill(
            { order_id: orderId, user_ids: ['user-prabowo', 'user-suges', 'user-orang']},
            (err, response) => {
                if(err) {
                    console.error('SplitBill error:', err.message);
                    return reject(err);
                }
                console.log('Split Bill: ');
                console.log(`    Total: Rp ${response.total.toLocaleString('id-ID')}`);
                response.bills.forEach(b => {
                    console.log(`     ${b.user_id} bayar: Rp${b.amount.toLocaleString('id-ID')}`); 
                });
                resolve();
            }
        );
    });
}

//7. Track order status (server streaming)
function testTrackOrderStatus(orderId){
    return new Promise((resolve, reject) => {
        divider('Test 7: TrackOrderStatus (Server Streaming)');
        console.log('Memantau status order...');
        const stream = orderClient.TrackOrderStatus({ order_id: orderId});

        stream.on('data', (status)=> {
            const time = new Date(Number(status.timestamp)).toLocaleTimeString('id-ID');
            console.log(`    [${time}] ${status.status} -- ${status.message}`);
        });
        
        stream.on('end', () => {
            console.log('Tracking selesai');
            resolve();
        });

        stream.on('error', (err) => {
            console.error('TrackOrderStatus error:', err.message);
            reject(err);
        });
    });
}

//8.stream daily progress (server streaming)
function testStreamDailyProgress(){
    return new Promise((resolve, reject) => {
        divider('Test 8: StreamDailyProgress (Server Streaming)');
        console.log('Memantau progress kalori (30 detik, update tiap 5 detik)');
        const stream = nutritionClient.StreamDailyProgress({ user_id: 'user-prabowo' });

        stream.on('data', (update) => {
            console.log( `    Kalori: ${update.current_calories}/${update.calorie_limit} kcal (${update.percentage}%) -- ${update.warning_message}`);
        });

        stream.on('end', () => {
            console.log('Stream progress selesai');
            resolve();
        });
        stream.on('error', (err)=> {
            console.error('StreamDailyProgress error:', err.message);
            reject(err);
        });
    });
}

//9. Vote menu(bidi streaming)
function testVoteMenu() {
    return new Promise((resolve, reject) => {
        divider('Test 9: VoteMenu (Bi-Directional Streaming)');
        console.log('Mulai sesi voting...');
        const call = menuClient.VoteMenu();

        call.on('data', (result) => {
            console.log(`     ${result.menu_name}: ${result.vote_count} vote${result.is_final ? ' (Final)': ''}`);
        });
        
        call.on('end', () => {
            console.log('Voting selesai');
            resolve();
        });

        call.on('error',(err) => {
            console.error('VoteMenu error:', err.message);
            reject(err);
        });

        //Simulasi 3 user vote berbeda
        const votes = [
            {user_id: 'user-prabowo', menu_id: 'menu-1'},
            {user_id: 'user-fufufafa', menu_id: 'menu-2'},
            {user_id: 'user_orang', menu_id: 'menu-1'},
        ];
        let i = 0;
        const voteInterval = setInterval(() => {
            if(i >= votes.length) {
                clearInterval(voteInterval);
                call.end();
                return;
            }
            console.log((    `${votes[i].user_id} vote untuk ${votes[i].menu_id}`));
            call.write(votes[i]);
            i++;
        }, 1000);
    });
}

// Run semua tes
async function runAllTest() {
    console.log('Mulai testing semua fitur grpc Meal Planner...');
    try {
        await testGetMenu();
        await delay(2000);

        await testAddMenu();
        await delay(2000);

        await testGetNutrition();
        await delay(2000);

        await testGetDailySummary();
        await delay(2000);

        const orderId = await testCreateOrder();
        await delay(2000);

        await testSplitBill(orderId);
        await delay(2000);

        await Promise.all([
            testTrackOrderStatus(orderId),
            testStreamDailyProgress(),
        ]);

        console.log('\n Semua test selesai');
    } catch (err) {
        console.error('\n Test gagal:', err.message);
    }
}

runAllTest();