import { endpoint } from '../lib/endpoint.js';
import { home } from '../lib/api.js';

export default endpoint((db, uid, input) => home(db, uid));
