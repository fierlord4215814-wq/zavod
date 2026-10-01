const h=require('./own.cjs'),e=require('./history-before.json'),{calculate,compare}=require('./independent.cjs');
const reference=calculate(e.primary,e.query,e.api['operations/overview'].period.asOf,e.actor),rows=compare(reference,e.api['operations/overview']);
h.receipt('history-independent-before',{status:rows.some(r=>r.STATUS==='FAIL_SQL_HTTP')?'PRODUCT_MISMATCHES':'PASS_SQL_HTTP_ONLY',reference,rows});
console.log(JSON.stringify({checked:rows.length,failures:rows.filter(r=>r.STATUS==='FAIL_SQL_HTTP').map(r=>({metric:r.METRIC,expected:r.EXPECTED,actual:r.API_ACTUAL,ids:r.SOURCE_ROWS}))}));
