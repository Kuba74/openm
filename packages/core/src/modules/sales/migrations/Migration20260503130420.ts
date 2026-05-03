import { Migration } from '@mikro-orm/migrations';

export class Migration20260503130420 extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "sales_settings" add "invoice_number_format" text not null default 'FV/{yyyy}/{mm}/{seq:5}', add "return_number_format" text not null default 'KOR/{yyyy}/{seq:5}', add "credit_memo_number_format" text not null default 'KFV/{yyyy}/{mm}/{seq:5}', add "default_currency_code" text null;`);
    this.addSql(`alter table "sales_settings" alter column "order_number_format" set default 'ZS/{yyyy}/{seq:5}';`);
    this.addSql(`alter table "sales_settings" alter column "quote_number_format" set default 'OF/{yyyy}/{seq:5}';`);

    this.addSql(`alter table "sales_tax_rates" add "is_exempt" boolean not null default false;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "sales_settings" drop column "invoice_number_format", drop column "return_number_format", drop column "credit_memo_number_format", drop column "default_currency_code";`);
    this.addSql(`alter table "sales_settings" alter column "order_number_format" set default 'ORDER-{yyyy}{mm}{dd}-{seq:5}';`);
    this.addSql(`alter table "sales_settings" alter column "quote_number_format" set default 'QUOTE-{yyyy}{mm}{dd}-{seq:5}';`);

    this.addSql(`alter table "sales_tax_rates" drop column "is_exempt";`);
  }

}
