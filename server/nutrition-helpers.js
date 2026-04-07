// Shared nutrition state dan helper functions
// Digunakan oleh nutrition-server.js dan order-server.js

const nutritionData = {
    'menu-1': { menu_name: 'Nasi Goreng', calories: 500, protein: 15, carbs: 70, fat: 18 },
    'menu-2': { menu_name: 'Mie Ayam', calories: 600, protein: 17, carbs: 85, fat: 14 },
    'menu-3': { menu_name: 'Sate Ayam', calories: 650, protein: 19, carbs: 50, fat: 20 },
    'menu-4': { menu_name: 'Gado-Gado', calories: 450, protein: 10, carbs: 45, fat: 19 },
};

const userDailyLog = {};
const CALORIE_LIMIT = 2000;

function log(message) {
    console.log(`[nutrition] ${message}`);
}

function addCaloriesToUser(userId, menuId) {
    const today = new Date().toISOString().split('T')[0];
    const key = `${userId}:${today}`;
    const calories = nutritionData[menuId]?.calories || 0;

    if (!userDailyLog[key]) userDailyLog[key] = { totalCalories: 0 };
    userDailyLog[key].totalCalories += calories;
    log(`addCaloriesToUser -> userId=${userId} menuId=${menuId} calories=${calories} total=${userDailyLog[key].totalCalories}`);
}

module.exports = {
    nutritionData,
    userDailyLog,
    CALORIE_LIMIT,
    log,
    addCaloriesToUser,
};
