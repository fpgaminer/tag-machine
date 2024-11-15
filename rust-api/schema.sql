CREATE TABLE IF NOT EXISTS tags (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tag text NOT NULL UNIQUE,
    active boolean NOT NULL
);

CREATE TABLE IF NOT EXISTS images_2 (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    hash bytea NOT NULL UNIQUE,
    active boolean NOT NULL,
    tags bigint[] NOT NULL,
    tags_blame jsonb NOT NULL DEFAULT '{}'::jsonb,
    embedding_1 bytea,
    embedding_2 halfvec(1152),  -- siglip-so400m-patch14-384
    caption TEXT,
    caption_blame BIGINT,       -- User ID of the user who last changed the caption
    tsv_caption tsvector GENERATED ALWAYS AS (to_tsvector('english', caption)) STORED
);

CREATE INDEX IF NOT EXISTS images_2_tags_idx ON images_2 USING GIN (tags);
--CREATE INDEX IF NOT EXISTS images_2_attributes_idx ON images_2 USING GIN (attributes);
CREATE INDEX IF NOT EXISTS images_2_tags_blame_idx ON images_2 USING GIN (tags_blame);
CREATE INDEX IF NOT EXISTS images_2_caption_tsv_idx ON images_2 USING GIN (tsv_caption);

CREATE TABLE IF NOT EXISTS image_attributes (
    image_id bigint NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    value_md5 bytea GENERATED ALWAYS AS (decode(md5(value), 'hex')) STORED,
    blame BIGINT NOT NULL,       -- User ID of the user who last added this attribute
    PRIMARY KEY (image_id, key, value_md5)
);

CREATE INDEX IF NOT EXISTS image_attributes_key_idx ON image_attributes (key);
CREATE INDEX IF NOT EXISTS image_attributes_value_md5_idx ON image_attributes USING HASH (value_md5);
CREATE INDEX IF NOT EXISTS image_attributes_key_value_idx ON image_attributes (key, value_md5);
CREATE INDEX IF NOT EXISTS image_attributes_image_id_idx ON image_attributes (image_id);


-- New version
-- Variations
--   action=add_tag: tag
--   action=remove_tag: tag
--   action=add_image: image_hash
--   action=remove_image: image_hash
--   action=add_image_tag: image_hash, tag
--   action=remove_image_tag: image_hash, tag
--   action=add_attribute: image_hash, key, value
--   action=remove_attribute: image_hash, key, value
--   action=caption: image_hash, value
CREATE TABLE IF NOT EXISTS logs (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "timestamp" timestamp without time zone NOT NULL DEFAULT (now() at time zone 'utc'),
    user_id bigint NOT NULL,
    action text NOT NULL,
    image_hash bytea,
    tag text,
    attribute_key text,
    attribute_value text,
    CHECK (
        (action = 'add_tag'          AND image_hash IS NULL     AND tag IS NOT NULL AND attribute_key IS NULL     AND attribute_value IS NULL) OR
        (action = 'remove_tag'       AND image_hash IS NULL     AND tag IS NOT NULL AND attribute_key IS NULL     AND attribute_value IS NULL) OR
        (action = 'add_image'        AND image_hash IS NOT NULL AND tag IS NULL     AND attribute_key IS NULL     AND attribute_value IS NULL) OR
        (action = 'remove_image'     AND image_hash IS NOT NULL AND tag IS NULL     AND attribute_key IS NULL     AND attribute_value IS NULL) OR
        (action = 'add_image_tag'    AND image_hash IS NOT NULL AND tag IS NOT NULL AND attribute_key IS NULL     AND attribute_value IS NULL) OR
        (action = 'remove_image_tag' AND image_hash IS NOT NULL AND tag IS NOT NULL AND attribute_key IS NULL     AND attribute_value IS NULL) OR
        (action = 'add_attribute'    AND image_hash IS NOT NULL AND tag IS NULL     AND attribute_key IS NOT NULL AND attribute_value IS NOT NULL) OR
        (action = 'remove_attribute' AND image_hash IS NOT NULL AND tag IS NULL     AND attribute_key IS NOT NULL AND attribute_value IS NOT NULL) OR
        (action = 'caption'          AND image_hash IS NOT NULL AND tag IS NULL     AND attribute_key IS NULL     AND attribute_value IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS logs_image_hash_idx ON logs USING HASH (image_hash);
CREATE INDEX IF NOT EXISTS logs_user_id_idx ON logs (user_id);
CREATE INDEX IF NOT EXISTS logs_timestamp_idx ON logs ("timestamp");


CREATE TABLE IF NOT EXISTS users (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    username text NOT NULL UNIQUE,
    login_key bytea NOT NULL,   -- SHA256 hash of the user's login key
    active boolean NOT NULL,
    is_admin boolean NOT NULL
);


CREATE TABLE IF NOT EXISTS user_tokens (
    token bytea NOT NULL PRIMARY KEY,   -- SHA256 hash of the user's login key
    user_id bigint NOT NULL,
    created_at bigint NOT NULL
);