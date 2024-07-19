export class JSONBinary {
    static #charTable = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));
    static #maskTable = Array.from({ length: 9 }, (_, i) => ~((2 ** i - 1) ^ 0xFF));
    static #powTable = Array.from({ length: 9 }, (_, i) => 2 ** i - 1);
    static #reversePowTable = Array.from({ length: 9 }, (_, i) => 10 ** i);
    #bitStream = '';
    #bitValue = 0;
    #bitsLeft = 8;
    #streamIndex = 0;
    BOOL = 0;
    INT = 1;
    FLOAT = 2;
    STRING = 3;
    ARRAY = 4;
    OBJECT = 5;
    CLOSE = 6;
    EOS = 7;
    #writeBits(value, count) {
        const overflow = count - this.#bitsLeft;
        const use = Math.min(this.#bitsLeft, count);
        const shift = this.#bitsLeft - use;
        if (overflow > 0)
            this.#bitValue += (value >> overflow) << shift;
        else
            this.#bitValue += value << shift;
        this.#bitsLeft -= use;
        if (this.#bitsLeft === 0) {
            this.#bitStream += JSONBinary.#charTable[this.#bitValue];
            this.#bitsLeft = 8;
            this.#bitValue = 0;
            if (overflow > 0) {
                this.#bitValue += (value & JSONBinary.#powTable[overflow]) << (8 - overflow);
                this.#bitsLeft -= overflow;
            }
        }
    }
    #readBits(count) {
        const overflow = count - this.#bitsLeft;
        const use = Math.min(this.#bitsLeft, count);
        const shift = this.#bitsLeft - use;
        let value = (this.#bitValue & JSONBinary.#maskTable[this.#bitsLeft]) >> shift;
        this.#bitsLeft -= use;
        if (this.#bitsLeft === 0) {
            this.#bitValue = this.#bitStream.charCodeAt(++this.#streamIndex);
            this.#bitsLeft = 8;
            if (overflow > 0) {
                value = (value << overflow) | ((this.#bitValue & JSONBinary.#maskTable[this.#bitsLeft]) >> (8 - overflow));
                this.#bitsLeft -= overflow;
            }
        }
        if (this.#streamIndex > this.#bitStream.length) return 7;
        return value;
    }
    #encodeValue(value, isTopLevel = false) {
        if (typeof value === 'number') this.#encodeNumber(value);
        else if (typeof value === 'string') this.#encodeString(value);
        else if (typeof value === 'boolean') this.#encodeBool(value)
        else if (value === null) this.#encodeNull();
        else if (Array.isArray(value)) this.#encodeArray(value, isTopLevel);
        else if (typeof value === 'object') this.#encodeObject(value, isTopLevel);
        else throw new Error('Unsupported type');
    }
    #encodeNumber(value) {
        const isFloat = !Number.isInteger(value);
        const isNegative = value < 0;
        value = Math.abs(value);
        this.#writeBits(1 + (isFloat ? 1 : 0), 3);
        if (isFloat) this.#encodeFloat(value);
        else this.#encodeInteger(value);
        this.#writeBits(isNegative ? 1 : 0, 1);
    }
    #encodeFloat(value) {
        let shift = 0;
        let multiplier = 10;
        let shiftedValue = value;
        let integerPart = 0;
        while (shiftedValue - Math.floor(shiftedValue) > 1 / multiplier && shift < 8 && shiftedValue < 214748364) {
            shiftedValue = value * multiplier;
            multiplier *= 10;
            shift++;
            integerPart = Math.floor(shiftedValue);
        }
        const step = integerPart / 10;
        if (Number.isInteger(step)) {
            integerPart = step;
            shift--;
        }
        this.#encodeInteger(integerPart);
        this.#writeBits(shift, 4);
    }
    #encodeInteger(value) {
        if (value < 2) {
            this.#writeBits(value, 4);
        } else if (value < 16) {
            this.#writeBits(1, 3);
            this.#writeBits(value, 4);
        } else if (value < 256) {
            this.#writeBits(2, 3);
            this.#writeBits(value, 8);
        } else if (value < 4096) {
            this.#writeBits(3, 3);
            this.#writeBits((value >> 8) & 0xff, 4);
            this.#writeBits(value & 0xff, 8);
        } else if (value < 65536) {
            this.#writeBits(4, 3);
            this.#writeBits((value >> 8) & 0xff, 8);
            this.#writeBits(value & 0xff, 8);
        } else if (value < 1048576) {
            this.#writeBits(5, 3);
            this.#writeBits((value >> 16) & 0xff, 4);
            this.#writeBits((value >> 8) & 0xff, 8);
            this.#writeBits(value & 0xff, 8);
        } else if (value < 16777216) {
            this.#writeBits(6, 3);
            this.#writeBits((value >> 16) & 0xff, 8);
            this.#writeBits((value >> 8) & 0xff, 8);
            this.#writeBits(value & 0xff, 8);
        } else {
            this.#writeBits(7, 3);
            this.#writeBits((value >> 24) & 0xff, 8);
            this.#writeBits((value >> 16) & 0xff, 8);
            this.#writeBits((value >> 8) & 0xff, 8);
            this.#writeBits(value & 0xff, 8);
        }
    }
    #encodeString(value) {
        const length = value.length;
        this.#writeBits(3, 3);
        if (length > 65535) {
            this.#writeBits(31, 5);
            this.#writeBits((length >> 24) & 0xff, 8);
            this.#writeBits((length >> 16) & 0xff, 8);
            this.#writeBits((length >> 8) & 0xff, 8);
            this.#writeBits(length & 0xff, 8);
        } else if (length > 255) {
            this.#writeBits(30, 5);
            this.#writeBits((length >> 8) & 0xff, 8);
            this.#writeBits(length & 0xff, 8);
        } else if (length > 28) {
            this.#writeBits(29, 5);
            this.#writeBits(length, 8);
        } else {
            this.#writeBits(length, 5);
        }
        if (this.#bitsLeft !== 8) {
            this.#bitStream += JSONBinary.#charTable[this.#bitValue];
            this.#bitValue = 0;
            this.#bitsLeft = 8;
        }
        this.#bitStream += value;
    }
    #encodeBool(value) {
        this.#writeBits(value ? 1 : 0, 4);
    }
    #encodeNull() {
        this.#writeBits(7, 3);
        this.#writeBits(0, 1);
    }
    #encodeArray(value, isTopLevel) {
        this.#writeBits(4, 3);
        for (const item of value) {
            this.#encodeValue(item);
        }
        if (!isTopLevel) {
            this.#writeBits(6, 3);
        }
    }
    #encodeObject(value, isTopLevel) {
        this.#writeBits(5, 3);
        for (const [key, val] of Object.entries(value)) {
            this.#encodeValue(key);
            this.#encodeValue(val);
        }
        if (!isTopLevel) {
            this.#writeBits(6, 3);
        }
    }
    encode(value) {
        this.#bitsLeft = 8;
        this.#bitValue = 0;
        this.#bitStream = '';
        this.#encodeValue(value, true);
        this.#writeBits(7, 3);
        this.#writeBits(1, 1);
        if (this.#bitValue > 0) {
            this.#bitStream += JSONBinary.#charTable[this.#bitValue];
        }
        return this.#bitStream;
    }
    decode(string) {
        const stack = [];
        let decoded;
        let top;
        let isObject = false;
        let getKey = false;
        let key;
        this.#bitsLeft = 8;
        this.#streamIndex = 0;
        this.#bitStream = string;
        this.#bitValue = this.#bitStream.charCodeAt(this.#streamIndex);
        while (true) {
            const type = this.#readBits(3);
            let value;
            switch (type) {
                case BOOL:
                    value = this.#readBits(1) === 1;
                    break;
                case INT:
                case FLOAT:
                    value = this.#decodeNumber(type === 2);
                    break;
                case STRING:
                    value = this.#decodeString();
                    if (getKey) {
                        key = value;
                        getKey = false;
                        continue;
                    }
                    break;
                case ARRAY:
                case OBJECT:
                    value = type === OBJECT ? {} : [];
                    if (decoded === undefined) {
                        decoded = value;
                    } else {
                        isObject ? top[key] = value : top.push(value);
                    }
                    top = stack[stack.length] = value;
                    isObject = !(top instanceof Array);
                    getKey = isObject;
                    continue;
                case CLOSE:
                    top = stack[stack.length - 1];
                    stack.length--;
                    isObject = !(top instanceof Array);
                    getKey = isObject;
                    continue;
                case EOS:
                    switch (this.#readBits(1)) {
                        case INT: return decoded;
                        case EOS: return undefined;
                        default: value = null;
                    }
                    break;
            }
            if (isObject) {
                top[key] = value;
                getKey = true;
            } else if (top !== undefined) {
                top.push(value);
            } else {
                return value;
            }
        }
    }
    #decodeNumber(isFloat) {
        let value;
        switch (this.#readBits(3)) {
            case 0:
                value = this.#readBits(1);
                break;
            case 1:
                value = this.#readBits(4);
                break;
            case 2:
                value = this.#readBits(8);
                break;
            case 3:
                value = (this.#readBits(4) << 8) + this.#readBits(8);
                break;
            case 4:
                value = (this.#readBits(8) << 8) + this.#readBits(8);
                break;
            case 5:
                value = (this.#readBits(4) << 16) + (this.#readBits(8) << 8) + this.#readBits(8);
                break;
            case 6:
                value = (this.#readBits(8) << 16) + (this.#readBits(8) << 8) + this.#readBits(8);
                break;
            case 7:
                value = (this.#readBits(8) << 24) + (this.#readBits(8) << 16) + (this.#readBits(8) << 8) + this.#readBits(8);
                break;
        }
        if (this.#readBits(1)) {
            value = -value;
        }
        if (isFloat) {
            value /= JSONBinary.#reversePowTable[this.#readBits(4)];
        }
        return value;
    }
    #decodeString() {
        let size = this.#readBits(5);
        switch (size) {
            case 31:
                size = (this.#readBits(8) << 24) + (this.#readBits(8) << 16) + (this.#readBits(8) << 8) + this.#readBits(8);
                break;
            case 30:
                size = (this.#readBits(8) << 8) + this.#readBits(8);
                break;
            case 29:
                size = this.#readBits(8);
                break;
        }
        if (this.#bitsLeft !== 8) {
            this.#streamIndex++;
            this.#bitValue = 0;
            this.#bitsLeft = 8;
        }
        const value = this.#bitStream.substring(this.#streamIndex, size);
        this.#streamIndex += size;
        this.#bitValue = this.#bitStream.charCodeAt(this.#streamIndex);
        return value;
    }
}
