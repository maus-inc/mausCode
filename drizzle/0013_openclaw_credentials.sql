CREATE TABLE `openclaw_credentials` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`provider` text DEFAULT 'openai' NOT NULL,
	`api_key` text,
	`model` text,
	`label` text,
	`connected_at` integer
);
