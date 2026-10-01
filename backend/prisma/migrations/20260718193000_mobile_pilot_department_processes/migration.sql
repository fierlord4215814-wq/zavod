-- Manual order requests may carry their own unit when they are not linked to a stock item.
ALTER TABLE "OrderRequest" ADD COLUMN "unit" TEXT;
