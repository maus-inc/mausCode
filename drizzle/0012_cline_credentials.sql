CREATE TABLE `cline_credentials` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`provider` text DEFAULT 'openrouter' NOT NULL,
	`api_key` text,
	`base_url` text,
	`model` text,
	`label` text,
	`connected_at` integer
);
