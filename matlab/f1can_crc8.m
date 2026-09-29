function crc = f1can_crc8(bytes)
%F1CAN_CRC8  CRC-8 SAE J1850 (poly 0x1D, init 0xFF, xorout 0xFF).
%   f1can_crc8(double('123456789')) returns 75 (0x4B), the standard check value.

    crc = 255;
    bytes = double(bytes(:)');
    for k = 1:numel(bytes)
        crc = bitxor(crc, bytes(k));
        for i = 1:8
            if bitand(crc, 128)
                crc = bitxor(mod(crc * 2, 256), 29);
            else
                crc = mod(crc * 2, 256);
            end
        end
    end
    crc = bitxor(crc, 255);
end
