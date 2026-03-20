const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const packageDef = protoLoader.loadSync('proto/nutrition.proto');
const proto = grpc.loadPackageDefinition(packageDef);