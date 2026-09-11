CREATE TABLE `native_endpoint_settings` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`openai_base_url` text,
	`anthropic_base_url` text,
	`updated_at` integer
);
