import {
    _decorator,
    Component,
    RigidBody2D, BoxCollider2D, IPhysics2DContact, Contact2DType,
    Input, EventKeyboard, KeyCode, input,
    Vec2,
    log,
} from 'cc';
const { ccclass, property } = _decorator;

@ccclass('QingheController')
export class QingheController extends Component {

    private rigidBody: RigidBody2D | null = null;
    private collider: BoxCollider2D | null = null;

    @property
    private moveSpeed = 5;
    @property
    private jumpSpeed = 10;
    @property
    private maxJumpCount = 2;
    @property
    private dashSpeed = 30;
    @property
    private dashDuration = 0.15;

    private leftPressed = false;
    private rightPressed = false;
    private jumpRequested = false;
    private dashRequested = false;

    private jumpCount = 0;
    private isDashing = false;
    private dashTimer = 0;

    private facingDirection = 1; // 1 = right, -1 = left

    private onBeginContact(
        selfCollider: BoxCollider2D,
        otherCollider: BoxCollider2D,
        contact: IPhysics2DContact | null
    ): void {
        log('[Qinghe Controller]: Begin contact: ', otherCollider.node.name);
        this.jumpCount = 0;
    }
    private onEndContact(
        selfCollider: BoxCollider2D,
        otherCollider: BoxCollider2D,
        contact: IPhysics2DContact | null
    ): void {
        log('[Qinghe Controller]: End contact: ', otherCollider.node.name);

    }

    private onKeyDown(event: EventKeyboard): void {
        switch (event.keyCode) {
            case KeyCode.KEY_A: case KeyCode.ARROW_LEFT:
                this.leftPressed = true;
                break;
            case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT:
                this.rightPressed = true;
                break;
            case KeyCode.SPACE:
                this.jumpRequested = true;
                break;
            case KeyCode.KEY_K:
                this.dashRequested = true;
                break;
            default: break;
        }
    }
    private onKeyUp(event: EventKeyboard): void {
        switch (event.keyCode) {
            case KeyCode.KEY_A: case KeyCode.ARROW_LEFT:
                this.leftPressed = false;
                break;
            case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT:
                this.rightPressed = false;
                break;
            default: break;
        }
    }

    private jump(velocity: Vec2): void {
        if (this.jumpCount >= this.maxJumpCount) {
            return;
        }
        velocity.y += this.jumpSpeed;
        this.jumpCount += 1;
    }

    private startDash(velocity: Vec2): void {
        if (this.jumpCount < 1 || this.isDashing) {
            return;
        }
        velocity.x = this.facingDirection * this.dashSpeed;
        this.isDashing = true;
        this.dashTimer = this.dashDuration;
    }
    private updateDash(dt: number, velocity: Vec2): void {
        this.dashTimer -= dt;
        if (this.dashTimer <= 0) {
            this.isDashing = false;
            this.dashTimer = 0;
            velocity.x = 0;
            return;
        }
    }

    private handleMovement(velocity: Vec2): void {
        let horizontal = 0;
        if (this.leftPressed) {
            horizontal -= 1;
        }
        if (this.rightPressed) {
            horizontal += 1;
        }

        if (horizontal > 0) {
            this.facingDirection = 1;
        }
        else if (horizontal < 0) {
            this.facingDirection = -1;
        }

        if (horizontal !== 0) {
            velocity.x = horizontal * this.moveSpeed;
        }
    }

    protected onLoad(): void {
        this.rigidBody = this.getComponent(RigidBody2D);
        if (!this.rigidBody) {
            throw new Error('[Qinghe Controller] RigidBody2D not found!');
        }

        this.collider = this.getComponent(BoxCollider2D);
        if (!this.collider) {
            throw new Error('[Qinghe Controller] BoxCollider2D not found!');
        }

        this.collider.on(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        this.collider.on(Contact2DType.END_CONTACT, this.onEndContact, this);

        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    protected onDestroy(): void {
        this.collider.off('onBeginContact', this.onBeginContact, this);
        this.collider.off('onEndContact', this.onEndContact, this);

        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    protected start(): void {
        log('[Qinghe Controller] start')
    }

    protected update(dt: number): void {
        const velocity = new Vec2(this.rigidBody.linearVelocity);
        if (this.dashRequested) {
            this.startDash(velocity);
            this.dashRequested = false;
        }
        else {
            if (this.jumpRequested) {
                this.jump(velocity);
                this.jumpRequested = false;
            }
            this.handleMovement(velocity);
        }

        if (this.isDashing) {
            this.updateDash(dt, velocity);
        }

        this.rigidBody.linearVelocity = velocity;
    }

}


