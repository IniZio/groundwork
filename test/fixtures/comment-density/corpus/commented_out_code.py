def process(data):
    result = []
    for item in data:
        # old_value = item.get('deprecated_key')
        # if old_value:
        #     result.append(transform(old_value))
        value = item.get('key')
        if value:
            result.append(value)
    return result
