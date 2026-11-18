import { endpoint } from '../lib/endpoint.js';
import { walletView } from '../lib/api.js';

export default endpoint((db, uid, input) => walletView(db, uid, input));
