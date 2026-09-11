CREATE TABLE `qwen_credentials` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`auth_type` text DEFAULT 'openai' NOT NULL,
	`api_key` text NOT NULL,
	`base_url` text,
	`model` text,
	`label` text,
	`connected_at` integer
);
