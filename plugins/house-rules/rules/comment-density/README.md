<!-- This file is generated. Do not edit manually. -->

# comment-density

Flags files where added comment lines exceed 5 per 100 added lines.

**Severity**: error | **Autofix**: yes

**Vehicles**: tree-sitter, diff

## Allowed

### 1 comment in 40 code lines stays under cap

```ts
// single rationale for this module
export const v0 = 0;
export const v1 = 1;
export const v2 = 2;
export const v3 = 3;
export const v4 = 4;
export const v5 = 5;
export const v6 = 6;
export const v7 = 7;
export const v8 = 8;
export const v9 = 9;
export const v10 = 10;
export const v11 = 11;
export const v12 = 12;
export const v13 = 13;
export const v14 = 14;
export const v15 = 15;
export const v16 = 16;
export const v17 = 17;
export const v18 = 18;
export const v19 = 19;
export const v20 = 20;
export const v21 = 21;
export const v22 = 22;
export const v23 = 23;
export const v24 = 24;
export const v25 = 25;
export const v26 = 26;
export const v27 = 27;
export const v28 = 28;
export const v29 = 29;
export const v30 = 30;
export const v31 = 31;
export const v32 = 32;
export const v33 = 33;
export const v34 = 34;
export const v35 = 35;
export const v36 = 36;
export const v37 = 37;
export const v38 = 38;
```

### reworded pre-existing comment via base is not net-new

```ts
// new explanation
export const v0 = 0;
export const v1 = 1;
export const v2 = 2;
export const v3 = 3;
export const v4 = 4;
export const v5 = 5;
export const v6 = 6;
export const v7 = 7;
export const v8 = 8;
export const v9 = 9;
export const v10 = 10;
export const v11 = 11;
export const v12 = 12;
export const v13 = 13;
export const v14 = 14;
export const v15 = 15;
export const v16 = 16;
export const v17 = 17;
export const v18 = 18;
export const v19 = 19;
```

### new comment above reword with extra new code keeps ratio under cap

```ts
// new intro note
// original note reworded
export const v0 = 0;
export const v1 = 1;
export const v2 = 2;
export const v3 = 3;
export const v4 = 4;
export const v5 = 5;
export const v6 = 6;
export const v7 = 7;
export const v8 = 8;
export const v9 = 9;
export const v10 = 10;
export const v11 = 11;
export const v12 = 12;
export const v13 = 13;
export const v14 = 14;
export const v15 = 15;
export const v16 = 16;
export const v17 = 17;
export const v18 = 18;
export const v19 = 19;
export const v20 = 20;
export const v21 = 21;
export const v22 = 22;
export const v23 = 23;
export const v24 = 24;
export const v25 = 25;
export const v26 = 26;
export const v27 = 27;
export const v28 = 28;
export const v29 = 29;
export const v30 = 30;
export const v31 = 31;
export const v32 = 32;
export const v33 = 33;
export const v34 = 34;
export const v35 = 35;
export const v36 = 36;
export const v37 = 37;
export const v38 = 38;
export const extra0 = 0;
export const extra1 = 1;
export const extra2 = 2;
export const extra3 = 3;
export const extra4 = 4;
export const extra5 = 5;
export const extra6 = 6;
export const extra7 = 7;
export const extra8 = 8;
export const extra9 = 9;
export const extra10 = 10;
export const extra11 = 11;
export const extra12 = 12;
export const extra13 = 13;
export const extra14 = 14;
export const extra15 = 15;
export const extra16 = 16;
export const extra17 = 17;
export const extra18 = 18;
export const extra19 = 19;
export const extra20 = 20;
```

### exempt @ts-ignore directive is not counted

```ts
// @ts-ignore
export const v0 = 0;
export const v1 = 1;
export const v2 = 2;
export const v3 = 3;
export const v4 = 4;
export const v5 = 5;
export const v6 = 6;
export const v7 = 7;
export const v8 = 8;
export const v9 = 9;
export const v10 = 10;
export const v11 = 11;
export const v12 = 12;
export const v13 = 13;
export const v14 = 14;
export const v15 = 15;
export const v16 = 16;
export const v17 = 17;
export const v18 = 18;
```

## Flagged

### dense new comments over cap

```ts
// comment line 0
// comment line 1
// comment line 2
// comment line 3
// comment line 4
// comment line 5
// comment line 6
// comment line 7
// comment line 8
// comment line 9
export const v0 = 0;
export const v1 = 1;
export const v2 = 2;
export const v3 = 3;
export const v4 = 4;
export const v5 = 5;
export const v6 = 6;
export const v7 = 7;
export const v8 = 8;
export const v9 = 9;
```

### reword plus several new narration lines pushes over cap

```ts
// base comment reworded
// narration 1
// narration 2
// narration 3
// narration 4
// narration 5
export const v0 = 0;
export const v1 = 1;
export const v2 = 2;
export const v3 = 3;
export const v4 = 4;
export const v5 = 5;
export const v6 = 6;
export const v7 = 7;
export const v8 = 8;
export const v9 = 9;
export const v10 = 10;
export const v11 = 11;
export const v12 = 12;
export const v13 = 13;
export const v14 = 14;
export const v15 = 15;
export const v16 = 16;
export const v17 = 17;
export const v18 = 18;
export const v19 = 19;
export const v20 = 20;
export const v21 = 21;
export const v22 = 22;
export const v23 = 23;
export const v24 = 24;
export const v25 = 25;
export const v26 = 26;
export const v27 = 27;
export const v28 = 28;
export const v29 = 29;
export const v30 = 30;
export const v31 = 31;
export const v32 = 32;
export const v33 = 33;
export const v34 = 34;
export const v35 = 35;
export const v36 = 36;
export const v37 = 37;
export const v38 = 38;
export const v39 = 39;
```

### narration inserted above reworded comment still flags with correct line

```ts
// narration a
// narration b
// narration c
// why old reworded
export const a = 1;
export const b = 2;
export const c = 3;
export const d = 4;
export const e = 5;
```

### python hash comments over cap

```py
# python comment 0
# python comment 1
# python comment 2
# python comment 3
# python comment 4
# python comment 5
# python comment 6
# python comment 7
# python comment 8
# python comment 9
x_0 = 0
x_1 = 1
x_2 = 2
x_3 = 3
x_4 = 4
x_5 = 5
x_6 = 6
x_7 = 7
x_8 = 8
x_9 = 9
```
