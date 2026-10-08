export function closureBlock(balance:number,held:number,locked:number,pending:number,frozen:boolean,waive:boolean) {
  if(frozen) return "Support must resolve the account restriction or dispute first.";
  if(pending || held!==0) return "Trades and withdrawals must be fully settled first.";
  if(balance<0 || locked<0 || locked>balance) return "Support must reconcile this wallet before closure.";
  if(balance-locked>0) return "Withdraw your available balance to your linked bank first. Normal fees and minimums apply; contact support if below the minimum.";
  if(locked>0 && !waive) return "Confirm that you give up only the still-locked promotional credit.";
  return null;
}
