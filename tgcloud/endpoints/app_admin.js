import { api } from 'sdk';
import { endpoint } from '../lib/endpoint.js';
import { admin } from '../lib/admin.js';

export default endpoint((db, uid, input) => admin(db, uid, input, { api }));
