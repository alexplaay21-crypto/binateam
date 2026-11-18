import { endpoint } from '../lib/endpoint.js';
import { me } from '../lib/api.js';

export default endpoint((db, uid, input) => me(db, uid));
