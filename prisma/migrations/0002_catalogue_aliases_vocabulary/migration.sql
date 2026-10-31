-- Extensions required for vector search and trigram indexes (free pgvector image).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "PartNumberAliasKind" AS ENUM ('PRIMARY', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "VocabularySource" AS ENUM ('name', 'category', 'make', 'model', 'chassis');

-- CreateTable
CREATE TABLE "CatalogueSku" (
    "sku" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "partNumberNorm" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "fitmentSummary" TEXT,
    "completeness" DOUBLE PRECISION NOT NULL,
    "hasFitmentRecord" BOOLEAN NOT NULL,
    "qualityFlags" JSONB NOT NULL,
    "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("nameEn", ''))) STORED,
    "embedding" vector(384),

    CONSTRAINT "CatalogueSku_pkey" PRIMARY KEY ("sku")
);

-- CreateTable
CREATE TABLE "PartNumberAlias" (
    "id" TEXT NOT NULL,
    "aliasNorm" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "kind" "PartNumberAliasKind" NOT NULL,
    "sourceTab" TEXT NOT NULL,
    "sourceColumn" TEXT NOT NULL,

    CONSTRAINT "PartNumberAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocabularyTerm" (
    "term" TEXT NOT NULL,
    "frequency" INTEGER NOT NULL,
    "source" "VocabularySource" NOT NULL,

    CONSTRAINT "VocabularyTerm_pkey" PRIMARY KEY ("term")
);

-- CreateIndex
CREATE INDEX "CatalogueSku_partNumberNorm_idx" ON "CatalogueSku"("partNumberNorm");

-- GIN index on the english tsvector (ARCH-37)
CREATE INDEX "CatalogueSku_searchVector_gin_idx" ON "CatalogueSku" USING GIN ("searchVector");

-- pg_trgm GIN on nameEn (ARCH-37)
CREATE INDEX "CatalogueSku_nameEn_trgm_idx" ON "CatalogueSku" USING GIN ("nameEn" gin_trgm_ops);

-- HNSW cosine index on embedding vector(384) (ARCH-37)
CREATE INDEX "CatalogueSku_embedding_hnsw_idx" ON "CatalogueSku" USING hnsw ("embedding" vector_cosine_ops);

-- CreateIndex
CREATE INDEX "PartNumberAlias_aliasNorm_idx" ON "PartNumberAlias"("aliasNorm");

-- pg_trgm GIN on vocabulary term (ARCH-48)
CREATE INDEX "VocabularyTerm_term_trgm_idx" ON "VocabularyTerm" USING GIN ("term" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "PartNumberAlias" ADD CONSTRAINT "PartNumberAlias_sku_fkey" FOREIGN KEY ("sku") REFERENCES "CatalogueSku"("sku") ON DELETE CASCADE ON UPDATE CASCADE;
