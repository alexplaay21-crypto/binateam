import { endpoint } from '../lib/endpoint.js';
import { create } from '../lib/api.js';

export default endpoint((db, uid, input) => create(db, uid, input));
