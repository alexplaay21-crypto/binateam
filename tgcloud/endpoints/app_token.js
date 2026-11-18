import { endpoint } from '../lib/endpoint.js';
import { token } from '../lib/api.js';

export default endpoint((db, uid, input) => token(db, uid, input));
