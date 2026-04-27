const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

const menuDef = protoLoader.loadSync('proto/menu.proto');
const nutritionDef = protoLoader.loadSync('proto/nutrition.proto');
const orderDef = protoLoader.loadSync('proto/order.proto');

const menuProto = grpc.loadPackageDefinition(menuDef).menu;
const nutritionProto = grpc.loadPackageDefinition(nutritionDef).nutrition;
const orderProto = grpc.loadPackageDefinition(orderDef).order;

const menuClient = new menuProto.MenuService('localhost:50051', grpc.credentials.createInsecure());
const nutritionClient = new nutritionProto.NutritionService('localhost:50052', grpc.credentials.createInsecure());
const orderClient = new orderProto.OrderService('localhost:50053', grpc.credentials.createInsecure());

const rl = readline.createInterface({ input: stdin, output: stdout });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pick(obj, snake, camel) {
	if (!obj) return undefined;
	if (Object.prototype.hasOwnProperty.call(obj, snake)) return obj[snake];
	return obj[camel];
}

function unaryCall(client, method, request) {
	return new Promise((resolve, reject) => {
		client[method](request, (err, response) => {
			if (err) return reject(err);
			resolve(response);
		});
	});
}

async function ask(message, defaultValue = '') {
	const suffix = defaultValue === '' ? '' : ` [${defaultValue}]`;
	const answer = (await rl.question(`${message}${suffix}: `)).trim();
	return answer || defaultValue;
}

async function askNumber(message, defaultValue) {
	while (true) {
		const value = await ask(message, String(defaultValue));
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
		console.log('Masukkan angka yang valid.');
	}
}

async function askList(message, defaultValue = '') {
	const answer = await ask(message, defaultValue);
	return answer.split(',').map((item) => item.trim()).filter(Boolean);
}

async function askYesNo(message, defaultYes = true) {
	const defaultValue = defaultYes ? 'y' : 'n';
	while (true) {
		const answer = (await ask(`${message} (y/n)`, defaultValue)).toLowerCase();
		if (answer === 'y' || answer === 'yes') return true;
		if (answer === 'n' || answer === 'no') return false;
		console.log('Masukkan y atau n.');
	}
}

async function inputNutritionForMenu(menuId, defaultMenuName = '', shouldAskMenuName = true) {
	const menuName = shouldAskMenuName
		? await ask('Nama menu untuk nutrisi', defaultMenuName || menuId)
		: (defaultMenuName || menuId);
	const calories = await askNumber('Kalori', 500);
	const protein = await askNumber('Protein (gram)', 20);
	const carbs = await askNumber('Karbohidrat (gram)', 50);
	const fat = await askNumber('Lemak (gram)', 15);

	const response = await unaryCall(nutritionClient, 'AddNutrition', {
		menu_id: menuId,
		menuId,
		menu_name: menuName,
		menuName,
		calories,
		protein,
		carbs,
		fat,
	});

	console.log(response.message || `Nutrisi untuk ${menuId} berhasil disimpan.`);
}

function printMenu() {
	console.log('\n=== MENU INTERAKTIF GRPC ===');
	console.log('1. Lihat menu');
	console.log('2. Tambah menu');
	console.log('3. Cek nutrisi');
	console.log('4. Rangkuman nutrisi harian');
	console.log('5. Buat order');
	console.log('6. Split bill');
	console.log('7. Lihat progress live voting');
	console.log('8. Progres kalori harian');
	console.log('9. Track order status');
	console.log('10. Proses live voting');
	console.log('0. Keluar');
}

function printMenus(menus) {
	if (!menus.length) {
		console.log('Belum ada menu.');
		return;
 	}

	console.log('Daftar menu:');
	menus.forEach((menu, index) => {
		const price = Number(menu.price || 0).toLocaleString('id-ID');
		console.log(`${index + 1}. ${menu.id} - ${menu.name} | Rp${price}`);
	});
}

async function viewMenu() {
	const menuList = await unaryCall(menuClient, 'GetMenu', {});
	printMenus(menuList.menus || []);
}

async function addMenu() {
	const name = await ask('Nama menu', 'Ayam Bakar Madu');
	const description = await ask('Deskripsi', 'Ayam bakar dengan saus madu');
	const price = await askNumber('Harga', 22000);

	const response = await unaryCall(menuClient, 'AddMenu', { name, description, price });
	const menuId = pick(response, 'menu_id', 'menuId');
	console.log(`Menu berhasil ditambah. ID: ${menuId}`);

	const shouldAddNutrition = await askYesNo('Ingin menambah nutrisi untuk menu ini?', true);
	if (shouldAddNutrition) {
		await inputNutritionForMenu(menuId, name, false);
	}
}

async function checkNutrition() {
	const menuId = await ask('Menu ID', 'menu-1');

	try {
		const nutrition = await unaryCall(nutritionClient, 'GetNutrition', { menu_id: menuId, menuId });
		console.log(`Kalori: ${nutrition.calories}`);
		console.log(`Protein: ${nutrition.protein}`);
		console.log(`Karbohidrat: ${nutrition.carbs}`);
		console.log(`Lemak: ${nutrition.fat}`);
		return;
	} catch (err) {
		if (err.code !== grpc.status.NOT_FOUND) {
			throw err;
		}

		console.log('Nutrisi belum ditambahkan untuk menu ini.');
		const shouldAddNutrition = await askYesNo('Ingin menambahkan nutrisi sekarang?', true);
		if (!shouldAddNutrition) {
			return;
		}

		await inputNutritionForMenu(menuId, menuId);
		const nutrition = await unaryCall(nutritionClient, 'GetNutrition', { menu_id: menuId, menuId });
		console.log(`Kalori: ${nutrition.calories}`);
		console.log(`Protein: ${nutrition.protein}`);
		console.log(`Karbohidrat: ${nutrition.carbs}`);
		console.log(`Lemak: ${nutrition.fat}`);
	}
}

async function dailyNutritionSummary() {
	const userId = await ask('User ID', 'user-001');
	const date = await ask('Tanggal (YYYY-MM-DD)', new Date().toISOString().split('T')[0]);
	const summary = await unaryCall(nutritionClient, 'GetDailySummary', {
		user_id: userId,
		userId,
		date,
	});
	console.log(`Total kalori: ${pick(summary, 'total_calories', 'totalCalories')}`);
	console.log(`Limit kalori: ${pick(summary, 'calorie_limit', 'calorieLimit')}`);
	console.log(`Over limit: ${pick(summary, 'is_over_limit', 'isOverLimit')}`);
}

async function createOrder() {
	const menuList = await unaryCall(menuClient, 'GetMenu', {});
	const menus = menuList.menus || [];
	printMenus(menus);
	const menuById = Object.fromEntries(menus.map((menu) => [menu.id, menu]));

	const userId = await ask('User ID', 'user-001');
	const itemCount = await askNumber('Jumlah item', 2);
	const items = [];

	for (let index = 0; index < itemCount; index += 1) {
		const itemNumber = index + 1;
		const menuId = await ask(`Menu ID item ${itemNumber}`, `menu-${itemNumber}`);
		const selectedMenu = menuById[menuId];

		if (!selectedMenu) {
			console.log(`Menu dengan ID ${menuId} tidak ditemukan.`);
			return;
		}

		items.push({
			menu_id: menuId,
			menuId,
			menu_name: selectedMenu.name,
			menuName: selectedMenu.name,
			quantity: 1,
			price: Number(selectedMenu.price || 0),
		});
	}

	const response = await unaryCall(orderClient, 'CreateOrder', {
		user_id: userId,
		userId,
		group_id: 'group-A',
		groupId: 'group-A',
		items,
	});
	console.log(`Order berhasil dibuat. ID: ${pick(response, 'order_id', 'orderId')}`);
}

async function splitBill() {
	const orderId = await ask('Order ID', '');
	const userIds = await askList('User ID dipisah koma', 'user-001,user-002,user-003');
	const response = await unaryCall(orderClient, 'SplitBill', {
		order_id: orderId,
		orderId,
		user_ids: userIds,
		userIds,
	});
	console.log(`Total: ${response.total}`);
	(response.bills || []).forEach((bill) => {
		console.log(`- ${pick(bill, 'user_id', 'userId')}: ${bill.amount}`);
	});
}

async function liveVoteProgress() {
	const sessionId = await ask('Room komunitas', 'room-komunitas-1');
	const watcher = menuClient.WatchVoteResult({ session_id: sessionId, sessionId });

	watcher.on('data', (data) => {
		const eventType = pick(data, 'event_type', 'eventType');
		if (eventType === 'USER_CHOICE') {
			console.log(`Pilihan user: ${pick(data, 'actor_user_id', 'actorUserId')} -> ${pick(data, 'actor_menu_name', 'actorMenuName')} (voters=${pick(data, 'total_voters', 'totalVoters')}, final=${pick(data, 'is_final', 'isFinal')})`);
			return;
		}
		if (eventType === 'NO_CHANGE') {
			console.log(`Tidak ada perubahan: ${pick(data, 'actor_user_id', 'actorUserId')} tetap memilih ${pick(data, 'actor_menu_name', 'actorMenuName')}`);
			return;
		}
		if (eventType === 'ERROR') {
			console.log(`Vote error untuk menu ${pick(data, 'menu_id', 'menuId')}`);
			return;
		}
		console.log(`Rekap: ${pick(data, 'menu_name', 'menuName')} = ${pick(data, 'vote_count', 'voteCount')} suara (voters=${pick(data, 'total_voters', 'totalVoters')}, final=${pick(data, 'is_final', 'isFinal')})`);
	});
	watcher.on('error', (err) => {
		if (err.code !== grpc.status.CANCELLED) console.error('WatchVoteResult error:', err.message);
	});

	await ask('Tekan Enter untuk berhenti');
	watcher.cancel();
	await wait(200);
}

async function dailyCalorieProgress() {
	const userId = await ask('User ID', 'user-001');
	const progressStream = nutritionClient.StreamDailyProgress({ user_id: userId, userId });

	progressStream.on('data', (data) => {
		console.log(`${pick(data, 'current_calories', 'currentCalories')}/${pick(data, 'calorie_limit', 'calorieLimit')} (${data.percentage}%) - ${pick(data, 'warning_message', 'warningMessage')}`);
	});
	progressStream.on('error', (err) => {
		if (err.code !== grpc.status.CANCELLED) console.error('StreamDailyProgress error:', err.message);
	});

	await ask('Tekan Enter untuk berhenti');
	progressStream.cancel();
	await wait(200);
}

async function trackOrderStatus() {
	const orderId = await ask('Order ID', '');
	const trackStream = orderClient.TrackOrderStatus({ order_id: orderId, orderId });

	trackStream.on('data', (data) => {
		console.log(`${data.status}: ${data.message}`);
	});
	trackStream.on('error', (err) => {
		if (err.code !== grpc.status.CANCELLED) console.error('TrackOrderStatus error:', err.message);
	});

	await ask('Tekan Enter untuk berhenti');
	trackStream.cancel();
	await wait(200);
}

async function processLiveVoting() {
	const sessionId = await ask('Room komunitas', 'room-komunitas-1');
	const userId = await ask('User ID', 'user-001');

	const menuList = await unaryCall(menuClient, 'GetMenu', {});
	const menus = menuList.menus || [];
	printMenus(menus);

	const selectedMenuIds = await askList('Pilih menu (boleh lebih dari satu, pisah koma)', 'menu-1,menu-2');

	const voteStream = menuClient.VoteMenu();
	voteStream.on('data', (data) => {
		const eventType = pick(data, 'event_type', 'eventType');
		if (eventType === 'USER_CHOICE') {
			console.log(`Tercatat: ${pick(data, 'actor_user_id', 'actorUserId')} pilih ${pick(data, 'actor_menu_name', 'actorMenuName')} (voters=${pick(data, 'total_voters', 'totalVoters')})`);
			return;
		}
		if (eventType === 'NO_CHANGE') {
			console.log(`Vote diabaikan: ${pick(data, 'actor_user_id', 'actorUserId')} masih memilih ${pick(data, 'actor_menu_name', 'actorMenuName')}`);
			return;
		}
		if (eventType === 'ERROR') {
			console.log(`Vote ditolak untuk menu ${pick(data, 'menu_id', 'menuId')}`);
			return;
		}
		console.log(`Rekap: ${pick(data, 'menu_name', 'menuName')} = ${pick(data, 'vote_count', 'voteCount')} suara (final=${pick(data, 'is_final', 'isFinal')})`);
	});
	voteStream.on('error', (err) => {
		if (err.code !== grpc.status.CANCELLED) console.error('VoteMenu error:', err.message);
	});

	if (!selectedMenuIds.length) {
		console.log('Minimal pilih satu menu.');
		voteStream.end();
		await wait(200);
		return;
	}

	for (const menuId of selectedMenuIds) {
		voteStream.write({
			user_id: userId,
			userId,
			session_id: sessionId,
			sessionId,
			menu_id: menuId,
			menuId: menuId,
		});
		await wait(300);
	}

	voteStream.end();
	await wait(500);
}

function closeClients() {
	menuClient.close();
	nutritionClient.close();
	orderClient.close();
}

async function runInteractiveClient() {
	const actions = {
		1: { handler: viewMenu, pauseAfter: true },
		2: { handler: addMenu, pauseAfter: true },
		3: { handler: checkNutrition, pauseAfter: true },
		4: { handler: dailyNutritionSummary, pauseAfter: true },
		5: { handler: createOrder, pauseAfter: true },
		6: { handler: splitBill, pauseAfter: true },
		7: { handler: liveVoteProgress, pauseAfter: false },
		8: { handler: dailyCalorieProgress, pauseAfter: false },
		9: { handler: trackOrderStatus, pauseAfter: false },
		10: { handler: processLiveVoting, pauseAfter: false },
	};

	while (true) {
		printMenu();
		const choice = (await ask('Pilih menu', '0')).trim();
		if (choice === '0') break;

		const action = actions[choice];
		if (!action) {
			console.log('Pilihan tidak valid.');
			continue;
		}

		try {
			await action.handler();
			if (action.pauseAfter) await ask('Tekan Enter untuk kembali ke menu');
		} catch (err) {
			console.error('Client gagal:', err.message);
			await ask('Tekan Enter untuk kembali ke menu');
		}
	}
}

async function main() {
	try {
		await runInteractiveClient();
	} catch (err) {
		console.error('Client gagal:', err.message);
	} finally {
		closeClients();
		rl.close();
	}
}

main();
