const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const def = protoLoader.loadSync('proto/nutrition.proto');
const proto = grpc.loadPackageDefinition(def).nutrition;

const server = new grpc.Server();
server.addService(proto.NutritionService.service, {
  GetDailySummary: (call, cb) => {
    console.log("SERVER RECEIVED REQ:", call.request);
    cb(null, {
      userId: call.request.userId,
      date: call.request.date,
      totalCalories: 999,
      calorieLimit: 2000,
      isOverLimit: false
    });
  }
});
server.bindAsync('0.0.0.0:55555', grpc.ServerCredentials.createInsecure(), () => {
    const client = new proto.NutritionService('localhost:55555', grpc.credentials.createInsecure());
    client.GetDailySummary({ userId: "user-123", date: "2023-01-01" }, (err, res) => {
        console.log("CLIENT RECEIVED RES:", res);
        server.forceShutdown();
    });
});
