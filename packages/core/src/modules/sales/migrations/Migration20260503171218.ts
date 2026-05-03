import { Migration } from '@mikro-orm/migrations';

export class Migration20260503171218 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "sales_quotes" add "sales_owner_user_id" uuid null, add "payment_terms" text null;`);
    this.addSql(`alter table "sales_orders" add "sales_owner_user_id" uuid null, add "payment_terms" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sales_quotes" drop column "sales_owner_user_id", drop column "payment_terms";`);
    this.addSql(`alter table "sales_orders" drop column "sales_owner_user_id", drop column "payment_terms";`);
  }

}
