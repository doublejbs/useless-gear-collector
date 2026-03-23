-- CreateTable
CREATE TABLE "product_id_seq" (
    "date_key" CHAR(6) NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_id_seq_pkey" PRIMARY KEY ("date_key")
);

-- CreateTable
CREATE TABLE "brand_aliases" (
    "alias" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,

    CONSTRAINT "brand_aliases_pkey" PRIMARY KEY ("alias")
);

-- CreateTable
CREATE TABLE "crawl_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "adapter_type" TEXT NOT NULL,
    "base_url" TEXT,
    "crawl_frequency_hours" INTEGER NOT NULL DEFAULT 168,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,

    CONSTRAINT "crawl_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "product_id" VARCHAR(12) NOT NULL,
    "group_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "brand_kr" TEXT NOT NULL DEFAULT '',
    "brand_en" TEXT NOT NULL DEFAULT '',
    "name_kr" TEXT NOT NULL DEFAULT '',
    "name_en" TEXT NOT NULL DEFAULT '',
    "color_kr" TEXT NOT NULL DEFAULT '',
    "color_en" TEXT NOT NULL DEFAULT '',
    "size_kr" TEXT NOT NULL DEFAULT '',
    "size_en" TEXT NOT NULL DEFAULT '',
    "weight" TEXT NOT NULL DEFAULT '',
    "sales_region" TEXT NOT NULL DEFAULT '',
    "naver_image_url" TEXT NOT NULL DEFAULT '',
    "specs" JSONB NOT NULL DEFAULT '{}',
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "crawl_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "items_found" INTEGER NOT NULL DEFAULT 0,
    "items_updated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "crawl_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" VARCHAR(12) NOT NULL,
    "source_id" UUID NOT NULL,
    "crawl_job_id" UUID,
    "source_url" TEXT NOT NULL,
    "price" DECIMAL(65,30),
    "currency" VARCHAR(3),
    "image_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_crawled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_source_id" UUID NOT NULL,
    "price" DECIMAL(65,30),
    "currency" VARCHAR(3),
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crawl_sources_name_key" ON "crawl_sources"("name");

-- CreateIndex
CREATE INDEX "products_group_id_idx" ON "products"("group_id");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "products_brand_en_idx" ON "products"("brand_en");

-- CreateIndex
CREATE INDEX "products_sales_region_idx" ON "products"("sales_region");

-- CreateIndex
CREATE INDEX "products_needs_review_idx" ON "products"("needs_review");

-- CreateIndex
CREATE UNIQUE INDEX "products_brand_en_name_en_color_en_size_en_key" ON "products"("brand_en", "name_en", "color_en", "size_en");

-- CreateIndex
CREATE UNIQUE INDEX "product_sources_source_url_key" ON "product_sources"("source_url");

-- CreateIndex
CREATE INDEX "product_sources_source_id_idx" ON "product_sources"("source_id");

-- CreateIndex
CREATE INDEX "product_sources_status_idx" ON "product_sources"("status");

-- CreateIndex
CREATE INDEX "product_sources_last_crawled_at_idx" ON "product_sources"("last_crawled_at");

-- CreateIndex
CREATE INDEX "price_history_product_source_id_recorded_at_idx" ON "price_history"("product_source_id", "recorded_at" DESC);

-- AddForeignKey
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "crawl_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sources" ADD CONSTRAINT "product_sources_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sources" ADD CONSTRAINT "product_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "crawl_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sources" ADD CONSTRAINT "product_sources_crawl_job_id_fkey" FOREIGN KEY ("crawl_job_id") REFERENCES "crawl_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_product_source_id_fkey" FOREIGN KEY ("product_source_id") REFERENCES "product_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
