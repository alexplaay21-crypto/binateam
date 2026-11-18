import { endpoint } from '../lib/endpoint.js';
import { top } from '../lib/api.js';

export default endpoint((db, uid) => top(db, uid));
