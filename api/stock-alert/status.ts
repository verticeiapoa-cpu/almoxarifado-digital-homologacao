import { handleStockAlert } from '../../server/stockAlert';
export default { fetch: (request: Request) => handleStockAlert(request, process.env) };
