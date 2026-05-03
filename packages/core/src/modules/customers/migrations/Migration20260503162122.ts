import { Migration } from '@mikro-orm/migrations';

export class Migration20260503162122 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "customer_tax_identities" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "country_code" text not null, "kind" text not null, "value" text not null, "valid_from" timestamptz null, "valid_to" timestamptz null, "is_primary" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "entity_id" uuid not null, primary key ("id"));`);
    this.addSql(`create unique index "customer_tax_identities_unique_active" on "customer_tax_identities" ("country_code", "kind", "value") where "deleted_at" is null;`);
    this.addSql(`create index "customer_tax_identities_kind_idx" on "customer_tax_identities" ("kind");`);
    this.addSql(`create index "customer_tax_identities_scope_idx" on "customer_tax_identities" ("organization_id", "tenant_id");`);
    this.addSql(`create index "customer_tax_identities_entity_idx" on "customer_tax_identities" ("entity_id");`);

    this.addSql(`alter table "customer_tax_identities" add constraint "customer_tax_identities_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id");`);

    this.addSql(`alter table "customer_deal_stage_transitions" drop constraint "customer_deal_stage_transitions_deal_id_foreign";`);

    this.addSql(`alter table "customer_deal_people" drop constraint "customer_deal_people_deal_id_foreign";`);
    this.addSql(`alter table "customer_deal_people" drop constraint "customer_deal_people_person_entity_id_foreign";`);

    this.addSql(`alter table "customer_deal_companies" drop constraint "customer_deal_companies_deal_id_foreign";`);
    this.addSql(`alter table "customer_deal_companies" drop constraint "customer_deal_companies_company_entity_id_foreign";`);

    this.addSql(`alter table "customer_companies" drop constraint "customer_companies_entity_id_foreign";`);

    this.addSql(`alter table "customer_company_billing" drop constraint "customer_company_billing_entity_id_foreign";`);

    this.addSql(`alter table "customer_comments" drop constraint "customer_comments_entity_id_foreign";`);
    this.addSql(`alter table "customer_comments" drop constraint "customer_comments_deal_id_foreign";`);

    this.addSql(`alter table "customer_addresses" drop constraint "customer_addresses_entity_id_foreign";`);

    this.addSql(`alter table "customer_activities" drop constraint "customer_activities_entity_id_foreign";`);
    this.addSql(`alter table "customer_activities" drop constraint "customer_activities_deal_id_foreign";`);

    this.addSql(`alter table "customer_interactions" drop constraint "customer_interactions_entity_id_foreign";`);

    this.addSql(`alter table "customer_label_assignments" drop constraint "customer_label_assignments_label_id_foreign";`);
    this.addSql(`alter table "customer_label_assignments" drop constraint "customer_label_assignments_entity_id_foreign";`);

    this.addSql(`alter table "customer_person_company_links" drop constraint "customer_person_company_links_person_entity_id_foreign";`);
    this.addSql(`alter table "customer_person_company_links" drop constraint "customer_person_company_links_company_entity_id_foreign";`);

    this.addSql(`alter table "customer_person_company_roles" drop constraint "customer_person_company_roles_person_entity_id_foreign";`);
    this.addSql(`alter table "customer_person_company_roles" drop constraint "customer_person_company_roles_company_entity_id_foreign";`);

    this.addSql(`alter table "customer_people" drop constraint "customer_people_entity_id_foreign";`);
    this.addSql(`alter table "customer_people" drop constraint "customer_people_company_entity_id_foreign";`);

    this.addSql(`alter table "customer_tag_assignments" drop constraint "customer_tag_assignments_tag_id_foreign";`);
    this.addSql(`alter table "customer_tag_assignments" drop constraint "customer_tag_assignments_entity_id_foreign";`);

    this.addSql(`alter table "customer_todo_links" drop constraint "customer_todo_links_entity_id_foreign";`);

    this.addSql(`alter table "customer_deal_stage_transitions" add constraint "customer_deal_stage_transitions_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id");`);

    this.addSql(`alter table "customer_deal_people" add constraint "customer_deal_people_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id");`);
    this.addSql(`alter table "customer_deal_people" add constraint "customer_deal_people_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id");`);

    this.addSql(`alter table "customer_deal_companies" add constraint "customer_deal_companies_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id");`);
    this.addSql(`alter table "customer_deal_companies" add constraint "customer_deal_companies_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id");`);

    this.addSql(`alter table "customer_companies" add "legal_form" text null, add "entity_type" text null, add "full_address_krs" text null;`);
    this.addSql(`alter table "customer_companies" add constraint "customer_companies_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id");`);

    this.addSql(`alter table "customer_company_billing" add "sales_owner_user_id" uuid null, add "default_offer_validity_days" int null default 30;`);
    this.addSql(`alter table "customer_company_billing" add constraint "customer_company_billing_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id");`);

    this.addSql(`alter table "customer_comments" add constraint "customer_comments_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id");`);
    this.addSql(`alter table "customer_comments" add constraint "customer_comments_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on delete set null;`);

    this.addSql(`alter table "customer_addresses" add "deleted_at" timestamptz null;`);
    this.addSql(`alter table "customer_addresses" add constraint "customer_addresses_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id");`);
    this.addSql(`create unique index "customer_addresses_primary_per_purpose_idx" on "customer_addresses" ("entity_id", "purpose") where "is_primary" = true and "deleted_at" is null;`);

    this.addSql(`alter table "customer_activities" add constraint "customer_activities_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id");`);
    this.addSql(`alter table "customer_activities" add constraint "customer_activities_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on delete set null;`);

    this.addSql(`alter table "customer_interactions" add constraint "customer_interactions_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id");`);

    this.addSql(`alter table "customer_label_assignments" add constraint "customer_label_assignments_label_id_foreign" foreign key ("label_id") references "customer_labels" ("id");`);
    this.addSql(`alter table "customer_label_assignments" add constraint "customer_label_assignments_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id");`);

    this.addSql(`alter table "customer_person_company_links" add constraint "customer_person_company_links_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id");`);
    this.addSql(`alter table "customer_person_company_links" add constraint "customer_person_company_links_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id");`);
    this.addSql(`create unique index "customer_person_company_links_primary_per_company_idx" on "customer_person_company_links" ("company_entity_id") where "is_primary" = true and "deleted_at" is null;`);

    this.addSql(`alter table "customer_person_company_roles" add constraint "customer_person_company_roles_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id");`);
    this.addSql(`alter table "customer_person_company_roles" add constraint "customer_person_company_roles_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id");`);

    this.addSql(`alter table "customer_people" add constraint "customer_people_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id");`);
    this.addSql(`alter table "customer_people" add constraint "customer_people_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on delete set null;`);

    this.addSql(`alter table "customer_tag_assignments" add constraint "customer_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "customer_tags" ("id");`);
    this.addSql(`alter table "customer_tag_assignments" add constraint "customer_tag_assignments_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id");`);

    this.addSql(`alter table "customer_todo_links" add constraint "customer_todo_links_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_deal_stage_transitions" drop constraint "customer_deal_stage_transitions_deal_id_foreign";`);

    this.addSql(`alter table "customer_deal_people" drop constraint "customer_deal_people_deal_id_foreign";`);
    this.addSql(`alter table "customer_deal_people" drop constraint "customer_deal_people_person_entity_id_foreign";`);

    this.addSql(`alter table "customer_deal_companies" drop constraint "customer_deal_companies_deal_id_foreign";`);
    this.addSql(`alter table "customer_deal_companies" drop constraint "customer_deal_companies_company_entity_id_foreign";`);

    this.addSql(`alter table "customer_companies" drop constraint "customer_companies_entity_id_foreign";`);

    this.addSql(`alter table "customer_company_billing" drop constraint "customer_company_billing_entity_id_foreign";`);

    this.addSql(`alter table "customer_comments" drop constraint "customer_comments_entity_id_foreign";`);
    this.addSql(`alter table "customer_comments" drop constraint "customer_comments_deal_id_foreign";`);

    this.addSql(`alter table "customer_addresses" drop constraint "customer_addresses_entity_id_foreign";`);

    this.addSql(`alter table "customer_activities" drop constraint "customer_activities_entity_id_foreign";`);
    this.addSql(`alter table "customer_activities" drop constraint "customer_activities_deal_id_foreign";`);

    this.addSql(`alter table "customer_interactions" drop constraint "customer_interactions_entity_id_foreign";`);

    this.addSql(`alter table "customer_label_assignments" drop constraint "customer_label_assignments_label_id_foreign";`);
    this.addSql(`alter table "customer_label_assignments" drop constraint "customer_label_assignments_entity_id_foreign";`);

    this.addSql(`alter table "customer_person_company_links" drop constraint "customer_person_company_links_person_entity_id_foreign";`);
    this.addSql(`alter table "customer_person_company_links" drop constraint "customer_person_company_links_company_entity_id_foreign";`);

    this.addSql(`alter table "customer_person_company_roles" drop constraint "customer_person_company_roles_person_entity_id_foreign";`);
    this.addSql(`alter table "customer_person_company_roles" drop constraint "customer_person_company_roles_company_entity_id_foreign";`);

    this.addSql(`alter table "customer_people" drop constraint "customer_people_entity_id_foreign";`);
    this.addSql(`alter table "customer_people" drop constraint "customer_people_company_entity_id_foreign";`);

    this.addSql(`alter table "customer_tag_assignments" drop constraint "customer_tag_assignments_tag_id_foreign";`);
    this.addSql(`alter table "customer_tag_assignments" drop constraint "customer_tag_assignments_entity_id_foreign";`);

    this.addSql(`alter table "customer_todo_links" drop constraint "customer_todo_links_entity_id_foreign";`);

    this.addSql(`alter table "customer_deal_stage_transitions" add constraint "customer_deal_stage_transitions_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade;`);

    this.addSql(`alter table "customer_deal_people" add constraint "customer_deal_people_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade;`);
    this.addSql(`alter table "customer_deal_people" add constraint "customer_deal_people_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`alter table "customer_deal_companies" add constraint "customer_deal_companies_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade;`);
    this.addSql(`alter table "customer_deal_companies" add constraint "customer_deal_companies_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`alter table "customer_companies" drop column "legal_form", drop column "entity_type", drop column "full_address_krs";`);
    this.addSql(`alter table "customer_companies" add constraint "customer_companies_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`alter table "customer_company_billing" drop column "sales_owner_user_id", drop column "default_offer_validity_days";`);
    this.addSql(`alter table "customer_company_billing" add constraint "customer_company_billing_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`alter table "customer_comments" add constraint "customer_comments_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);
    this.addSql(`alter table "customer_comments" add constraint "customer_comments_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade on delete set null;`);

    this.addSql(`drop index "customer_addresses_primary_per_purpose_idx";`);
    this.addSql(`alter table "customer_addresses" drop column "deleted_at";`);
    this.addSql(`alter table "customer_addresses" add constraint "customer_addresses_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`alter table "customer_activities" add constraint "customer_activities_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);
    this.addSql(`alter table "customer_activities" add constraint "customer_activities_deal_id_foreign" foreign key ("deal_id") references "customer_deals" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "customer_interactions" add constraint "customer_interactions_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`alter table "customer_label_assignments" add constraint "customer_label_assignments_label_id_foreign" foreign key ("label_id") references "customer_labels" ("id") on update cascade;`);
    this.addSql(`alter table "customer_label_assignments" add constraint "customer_label_assignments_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`drop index "customer_person_company_links_primary_per_company_idx";`);
    this.addSql(`alter table "customer_person_company_links" add constraint "customer_person_company_links_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id") on update cascade;`);
    this.addSql(`alter table "customer_person_company_links" add constraint "customer_person_company_links_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`alter table "customer_person_company_roles" add constraint "customer_person_company_roles_person_entity_id_foreign" foreign key ("person_entity_id") references "customer_entities" ("id") on update cascade;`);
    this.addSql(`alter table "customer_person_company_roles" add constraint "customer_person_company_roles_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`alter table "customer_people" add constraint "customer_people_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);
    this.addSql(`alter table "customer_people" add constraint "customer_people_company_entity_id_foreign" foreign key ("company_entity_id") references "customer_entities" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "customer_tag_assignments" add constraint "customer_tag_assignments_tag_id_foreign" foreign key ("tag_id") references "customer_tags" ("id") on update cascade;`);
    this.addSql(`alter table "customer_tag_assignments" add constraint "customer_tag_assignments_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);

    this.addSql(`alter table "customer_todo_links" add constraint "customer_todo_links_entity_id_foreign" foreign key ("entity_id") references "customer_entities" ("id") on update cascade;`);
  }

}
