function [name, v, ok, err] = f1can_decode(id, data)
%F1CAN_DECODE  Decode one F1 CAN Telemetry Lab frame without any toolbox.
%
%   [name, v, ok, err] = f1can_decode(id, data)
%
%   id    arbitration ID (numeric, e.g. 0x101 = 257)
%   data  1x8 (or 1x2) bytes, any numeric class
%
%   Returns the message name, a struct of physical signal values, ok=false and an
%   error string on unknown IDs, short frames or an end-to-end CRC mismatch.
%
%   Bytes are converted to double before any arithmetic and signals are read bit by bit
%   using the same Intel (little-endian) layout declared in dbc/f1_telemetry.dbc.
%
%   Runs in MATLAB R2016b+ and GNU Octave 6+.

    name = ''; v = struct(); ok = false; err = '';
    b = double(data(:)');
    spec = f1can_spec();
    k = find([spec.id] == double(id), 1);
    if isempty(k)
        err = sprintf('unknown arbitration id 0x%03X', double(id));
        return
    end
    m = spec(k);
    name = m.name;
    if numel(b) < m.dlc
        err = sprintf('%s: expected %d bytes, got %d', m.name, m.dlc, numel(b));
        return
    end
    b = b(1:m.dlc);
    % 1 x (8*dlc) bit vector, bit 0 = LSB of byte 0 (Intel numbering)
    bits = reshape(fliplr(dec2bin(b, 8))' - '0', 1, []);
    for s = 1:numel(m.signals)
        sg = m.signals(s);
        raw = bits(sg.start + (1:sg.len)) * (2 .^ (0:sg.len - 1))';
        if sg.signed && raw >= 2^(sg.len - 1)
            raw = raw - 2^sg.len;
        end
        v.(sg.name) = raw * sg.scale + sg.offset;
    end
    if isfield(v, 'CRC8')
        expected = f1can_crc8(b(1:7));
        if expected ~= v.CRC8
            err = sprintf('CRC mismatch: frame says 0x%02X, computed 0x%02X', v.CRC8, expected);
            return
        end
    end
    ok = true;
end
