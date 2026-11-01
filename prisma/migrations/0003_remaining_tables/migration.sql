-- CreateEnum
CREATE TYPE "LatencyKind" AS ENUM ('search', 'advisor');

-- CreateTable
CREATE TABLE "Vehicle" (
    "vehicleId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "chassisCode" TEXT NOT NULL,
    "chassisCodeNorm" TEXT NOT NULL,
    "yearFrom" INTEGER NOT NULL,
    "yearTo" INTEGER NOT NULL,
    "populationByEmirate" JSONB NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("vehicleId")
);

-- CreateTable
CREATE TABLE "Fitment" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "raw" JSONB NOT NULL,

    CONSTRAINT "Fitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VinDecode" (
    "vin" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "chassis" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "vehicleId" TEXT,

    CONSTRAINT "VinDecode_pkey" PRIMARY KEY ("vin")
);

-- CreateTable
CREATE TABLE "Seller" (
    "sellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "emirate" TEXT NOT NULL,
    "specialistMakes" TEXT[],
    "rating" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("sellerId")
);

-- CreateTable
CREATE TABLE "Listing" (
    "listingId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "stock" INTEGER NOT NULL,
    "warranty" TEXT NOT NULL,
    "deliveryDays" INTEGER NOT NULL,
    "recentSales" INTEGER NOT NULL,
    "excludedFromRanking" BOOLEAN NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("listingId")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "orderLineId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "returned" BOOLEAN NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("orderLineId")
);

-- CreateTable
CREATE TABLE "SearchLog" (
    "id" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "todayResultCount" INTEGER NOT NULL,
    "nextAction" TEXT NOT NULL,
    "searchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchEval" (
    "id" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "expectedSkus" TEXT[],

    CONSTRAINT "SearchEval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRule" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SystemStandIn" (
    "systemName" TEXT NOT NULL,
    "holds" TEXT NOT NULL,
    "standInTab" TEXT NOT NULL,

    CONSTRAINT "SystemStandIn_pkey" PRIMARY KEY ("systemName")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "file" TEXT NOT NULL,
    "counts" JSONB NOT NULL,
    "supersessionSource" JSONB,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataQualityIssue" (
    "id" TEXT NOT NULL,
    "importRunId" TEXT NOT NULL,
    "tab" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "issueType" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "handling" TEXT NOT NULL,

    CONSTRAINT "DataQualityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Basket" (
    "sessionId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Basket_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "BasketItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "listingId" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BasketItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvisorSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "faultText" TEXT,
    "parsed" JSONB,
    "vehicleId" TEXT,
    "questions" JSONB,
    "answers" JSONB,
    "proposals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvisorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LatencySample" (
    "id" TEXT NOT NULL,
    "evalRunId" TEXT,
    "kind" "LatencyKind" NOT NULL,
    "ms" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LatencySample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vehicle_chassisCodeNorm_idx" ON "Vehicle"("chassisCodeNorm");

-- CreateIndex
CREATE INDEX "Fitment_vehicleId_sku_idx" ON "Fitment"("vehicleId", "sku");

-- CreateIndex
CREATE INDEX "Fitment_sku_idx" ON "Fitment"("sku");

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_sku_fkey" FOREIGN KEY ("sku") REFERENCES "CatalogueSku"("sku") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fitment" ADD CONSTRAINT "Fitment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("vehicleId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinDecode" ADD CONSTRAINT "VinDecode_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("vehicleId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sku_fkey" FOREIGN KEY ("sku") REFERENCES "CatalogueSku"("sku") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("sellerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityIssue" ADD CONSTRAINT "DataQualityIssue_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketItem" ADD CONSTRAINT "BasketItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Basket"("sessionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketItem" ADD CONSTRAINT "BasketItem_sku_fkey" FOREIGN KEY ("sku") REFERENCES "CatalogueSku"("sku") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketItem" ADD CONSTRAINT "BasketItem_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("listingId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LatencySample" ADD CONSTRAINT "LatencySample_evalRunId_fkey" FOREIGN KEY ("evalRunId") REFERENCES "EvalRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
