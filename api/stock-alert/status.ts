import { handleStockAlert } from '../../server/stockAlert.js';
export default { fetch: (request: Request) => handleStockAlert(request, process.env) };
