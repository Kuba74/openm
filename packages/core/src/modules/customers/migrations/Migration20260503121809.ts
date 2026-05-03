import { Migration } from '@mikro-orm/migrations';

export class Migration20260503121809 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "customer_tax_identities" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "country_code" text not null, "kind" text not null, "value" text not null, "valid_from" timestamptz null, "valid_to" timestamptz null, "is_primary" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "entity_id" uuid not null, constraint "customer_tax_identities_pkey" primary key ("id"));`);
    this.addSql(`create unique index "customer_tax_identities_unique_active" on "customer_tax_identities" ("country_code", "kind", "value") where "deleted_at" is null;`);
    this.addSql(`create index "customer_tax_identities_kind_idx" on "customer_tax_identities" ("kind");`);
    this.addSql(`create index "customer_tax_identities_scope_idx" on "customer_tax_identities" ("organization_id", "tenant_id");`);
    this.addSql(`create index "customer_tax_identities_entity_idx" on "customer_tax_identities" ("entity_id");`);

    this.addSql(`alter table "customer_tax_identities" add constraint "customer_tax_identities_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`alter table "customer_companies" add column "legal_form" text null, add column "entity_type" text null, add column "full_address_krs" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_companies" drop column "legal_form", drop column "entity_type", drop column "full_address_krs";`);
  }

}
