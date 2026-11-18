import { endpoint } from '../lib/endpoint.js';
import { swapApi } from '../lib/api.js';

export default endpoint((db, uid, input) => swapApi(db, uid, input));
